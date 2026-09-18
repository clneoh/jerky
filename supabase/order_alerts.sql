-- Order alerts — your phone pings the moment an order lands.
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the tables are created only if missing, the function and
-- trigger are replaced, and an existing topic is left alone.
--
-- Why: a customer can order at any hour. Without this, you only find out the
-- next time you open the app. With it, the database itself sends a push
-- notification to your phone within a few seconds — even while the app is
-- closed and no computer is switched on.
--
-- How it works:
--   * A row lands in `incoming_orders` (the customer tapped "Place order").
--   * A trigger reads the order's JSON and formats a plain-text summary.
--   * It calls `net.http_post` (the pg_net extension) to hand that summary to
--     the free ntfy service, which pushes it to whichever phones have
--     subscribed to your private channel.
--
-- Two notes about the design, both deliberate:
--   * The channel name is a SECRET — anyone who knows it can read your alerts.
--     It is generated below, stored in this database, and deliberately NOT
--     written into the app's code or the GitHub repo. The last line of this
--     script shows it to you; copy it from there.
--   * Nothing here is allowed to block a customer's order. Any failure is
--     swallowed and recorded in `order_alert_errors`, so the order is always
--     saved and you can look up what went wrong later.


-- 1. pg_net — the extension that lets the database make an HTTP call.
--    Supabase usually has this already; "if not exists" makes it a no-op then.
create extension if not exists pg_net with schema "extensions";


-- 2. Your private channel name. One row, created once, never overwritten.
create table if not exists public.order_alert_topic (
  id     integer primary key default 1 check (id = 1),
  topic  text not null,
  set_at timestamptz not null default now()
);
alter table public.order_alert_topic enable row level security;

insert into public.order_alert_topic (id, topic)
values (1, 'furkidz-orders-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
on conflict (id) do nothing;


-- 3. One row per order already announced, so a re-read never pings twice.
create table if not exists public.order_alert_log (
  id      uuid primary key,
  sent_at timestamptz not null default now()
);
alter table public.order_alert_log enable row level security;


-- 4. Anything that went wrong while announcing an order, for later inspection.
create table if not exists public.order_alert_errors (
  id        bigserial primary key,
  order_id  uuid,
  err       text,
  detail    text,
  context   text,
  at        timestamptz not null default now()
);
alter table public.order_alert_errors enable row level security;


-- 5. The worker. Security definer so it can read the topic table and reach
--    pg_net even though the customer who triggered it is anonymous.
create or replace function public.alert_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j       jsonb;
  topic   text;
  items   text;
  l       jsonb;
  lname   text;
  lqty    text;
  odate   text;
  day_txt text;
  how     text;
  total   text;
  note    text;
  addr    text;
  who     text;
  wa      text;
  msg     text;
  n       integer;
begin
  -- Only a freshly placed order is announced. The app re-reads and re-writes
  -- rows constantly; those edits must stay silent.
  if new.status is distinct from 'new' then
    return new;
  end if;

  -- The whole job is best-effort. A problem here must never stop a customer's
  -- order being saved, so everything is wrapped and failures are recorded.
  begin
    insert into public.order_alert_log(id) values (new.id)
      on conflict (id) do nothing;
    get diagnostics n = row_count;
    if n = 0 then
      return new;                          -- already announced this order
    end if;

    select t.topic into topic
      from public.order_alert_topic t
     where t.id = 1;
    if topic is null or btrim(topic) = '' then
      return new;                          -- not set up yet: nothing to ping
    end if;

    j := new.data::jsonb;

    -- "Chicken Jerky x2, Beef Bites x1"
    if jsonb_typeof(j -> 'lines') = 'array' then
      for l in select * from jsonb_array_elements(j -> 'lines') loop
        lname := btrim(coalesce(l ->> 'name', ''));
        if lname = '' then
          lname := 'item';
        end if;
        lqty := btrim(coalesce(l ->> 'qty', ''));
        if lqty = '' then
          lqty := '?';
        end if;
        items := coalesce(items || ', ', '') || lname || ' x' || lqty;
      end loop;
    end if;

    -- The storefront sends YYYY-MM-DD; print it the way a person reads it.
    odate := nullif(btrim(coalesce(j ->> 'date', '')), '');
    day_txt := odate;
    if odate ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      day_txt := to_char(to_date(odate, 'YYYY-MM-DD'), 'Dy DD Mon YYYY');
    end if;

    how := case when j ->> 'fulfillment' = 'courier'
                then 'Post (nationwide)'
                else 'Collect (local)' end;

    total := nullif(btrim(coalesce(j ->> 'total', '')), '');
    if total ~ '^[0-9]+(\.[0-9]+)?$' then
      total := 'RM ' || to_char(total::numeric, 'FM999999999990.00');
    end if;

    who  := nullif(btrim(coalesce(j ->> 'customer', '')), '');
    wa   := nullif(btrim(coalesce(j ->> 'whatsapp', '')), '');
    note := nullif(btrim(coalesce(j ->> 'note', '')), '');
    addr := nullif(btrim(coalesce(j ->> 'address', '')), '');

    -- A null line drops out of the array, so the message only carries what
    -- the order actually has.
    msg := array_to_string(array_remove(array[
      'Name: '     || who,
      'WhatsApp: ' || wa,
      'Items: '    || items,
      'Posting: '  || day_txt || ' - ' || how,
      'Total: '    || total,
      'Note: '     || note,
      'Address: '  || addr
    ], null::text), E'\n');
    if btrim(coalesce(msg, '')) = '' then
      msg := 'Open the app to see the order.';   -- an order with no readable detail
    end if;

    perform net.http_post(
      url     := 'https://ntfy.sh',
      body    := jsonb_build_object(
                   'topic',    topic,
                   'title',    'New order - Munchies Furkidz',
                   'message',  msg,
                   'tags',     jsonb_build_array('dog'),
                   'priority', 4
                 ),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    -- Recording the failure is itself wrapped: if even this insert cannot run,
    -- it is swallowed rather than allowed to block the customer's order.
    begin
      insert into public.order_alert_errors(order_id, err, detail, context)
      values (new.id, SQLERRM, SQLSTATE, left(coalesce(msg, new.data), 2000));
    exception when others then
      null;
    end;
  end;

  return new;
end;
$$;


-- 6. Fire it on every new order. Sits happily beside the "N left" trigger that
--    already listens to the same table.
drop trigger if exists order_alert_trg on public.incoming_orders;
create trigger order_alert_trg
  after insert on public.incoming_orders
  for each row
  execute function public.alert_new_order();


-- ─────────────────────────────────────────────────────────────────────────────
-- YOUR PRIVATE CHANNEL — the one thing to copy out of here.
--
-- This is a secret. It is the password to your own alerts: anyone who knows it
-- can read them. Do not put it in the app, the repo, or any message. Type it
-- into the ntfy app on each phone. (If it ever leaks, uncomment the UPDATE at
-- the bottom, run it, and re-subscribe every phone to the new name.)
-- ─────────────────────────────────────────────────────────────────────────────
select topic as "Your private ntfy topic" from public.order_alert_topic where id = 1;

-- Rotate the channel if it ever leaks (then re-subscribe every phone):
-- update public.order_alert_topic
--    set topic  = 'furkidz-orders-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
--        set_at = now()
--  where id = 1;

-- If a ping ever fails, this is where the reason is written down:
-- select * from public.order_alert_errors order by at desc limit 20;

-- How many orders have been announced (should climb with your orders):
--  select count(*) from public.order_alert_log;
