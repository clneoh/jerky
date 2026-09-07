-- Instant "N left" for the shared availability pool — lower the storefront
-- counts the moment an order lands, pool-aware.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: columns are added with IF NOT EXISTS, the function is
-- replaced and the trigger recreated.
--
-- What changed vs the old instant_slots.sql: value packs (e.g. "Focaccia
-- Family (4 pcs)") no longer own an independent count. A pack shares its
-- base product's daily pool, so the storefront publishes TWO kinds of row:
--   * a BASE row for the single product, in whole pieces (pool_base IS NULL);
--   * DERIVED rows for each pack, keyed by the pack's name, whose slots_left
--     is floor(base pieces left ÷ pack size) and which carry pool_base +
--     pool_qty so the database can tell them apart.
--
-- The backoffice app recomputes everything from the pool whenever a phone is
-- awake, and this trigger covers the moments in between. Derived rows are
-- never decremented on their own — they are recomputed from their base's row
-- after every order, so the count can't drift or double-count.
--
-- An order's JSON is now {date, lines:[{name,qty,price}], pool:[{name,qty}]}
-- where `lines` lists what the customer sees (packs and singles), and `pool`
-- lists the base pieces every pack consumes (name = base product, qty =
-- number of pieces). Singles are already in `lines`, so only packs appear in
-- `pool`. `pool` never adds to the day's count — one pack is one delivery.
--
-- Best-effort by design: if anything can't be read, the order is still saved
-- and the counts are left for the next app recalc.

alter table public.product_availability
  add column if not exists pool_base text,
  add column if not exists pool_qty  integer;

create or replace function public.decrement_slots_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j        jsonb;
  odate    text;
  line     jsonb;
  lname    text;
  lqty     integer;
  day_qty  integer := 0;
  p        jsonb;
  pname    text;
  pqty     integer;
begin
  -- Only newly placed orders change the counts.
  if new.status is distinct from 'new' then
    return new;
  end if;

  -- Everything below is best-effort. A problem must never stop the order
  -- being saved — any error is swallowed and the app's next recalc catches up.
  begin
    begin
      j := new.data::jsonb;
    exception when others then
      return new; -- not readable JSON → nothing to adjust
    end;

    odate := j->>'date';
    if odate is null
       or odate !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(j->'lines') <> 'array' then
      return new;
    end if;

    -- 1) Top-level lines. Each one lowers the matching product row by its
    --    quantity — but only if the row is a BASE row. A derived pack row
    --    (pool_base IS NOT NULL) is never decremented on its own: it gets
    --    recomputed from the pool in step 4.
    for line in select * from jsonb_array_elements(j->'lines') loop
      lname := coalesce(btrim(line->>'name'), '');
      if jsonb_typeof(line->'qty') = 'number'
         and (line->>'qty') ~ '^[0-9]+$' then
        lqty := (line->>'qty')::integer;
      else
        lqty := 0;
      end if;
      if lqty < 1 or lname = '' then
        continue;
      end if;
      day_qty := day_qty + lqty;
      update public.product_availability
        set slots_left = greatest(0, slots_left - lqty), updated_at = now()
        where date = odate and product = lname and pool_base is null;
    end loop;

    -- 2) The day's availability (the date pill) drops by the top-level count.
    --    Pool pieces are NOT day slots, so they don't touch this.
    if day_qty > 0 then
      update public.availability
        set slots_left = greatest(0, slots_left - day_qty), updated_at = now()
        where date = odate;
    end if;

    -- 3) Every pack in `pool` draws its base out of the shared pool in whole
    --    pieces: lower that base's row by the pieces the pack just took.
    if jsonb_typeof(j->'pool') = 'array' then
      for p in select * from jsonb_array_elements(j->'pool') loop
        pname := coalesce(btrim(p->>'name'), '');
        if jsonb_typeof(p->'qty') = 'number'
           and (p->>'qty') ~ '^[0-9]+$' then
          pqty := (p->>'qty')::integer;
        else
          pqty := 0;
        end if;
        if pqty < 1 or pname = '' then
          continue;
        end if;
        update public.product_availability
          set slots_left = greatest(0, slots_left - pqty), updated_at = now()
          where date = odate and product = pname and pool_base is null;
      end loop;
    end if;

    -- 4) Recompute every derived row on this date from its base's row, so a
    --    pack's "N left" always reads floor(base pieces ÷ pack size) with no
    --    drift. A pack with no base row that day keeps whatever it has.
    update public.product_availability pa
      set slots_left = greatest(0, floor(coalesce(b.slots_left, 0)::numeric / pa.pool_qty)),
          updated_at = now()
      from public.product_availability b
      where pa.date = odate
        and pa.pool_base is not null
        and pa.pool_qty is not null
        and pa.pool_qty > 0
        and b.date = pa.date
        and b.product = pa.pool_base
        and b.pool_base is null;
  exception when others then
    null; -- never block an order; the app's recalc will fix the counts later
  end;

  return new;
end;
$$;

drop trigger if exists incoming_order_slots_trg on public.incoming_orders;
create trigger incoming_order_slots_trg
  after insert on public.incoming_orders
  for each row
  execute function public.decrement_slots_on_order();

-- Sanity check you can run afterwards (should print incoming_order_slots_trg):
-- select tgname from pg_trigger
-- where tgrelid = 'public.incoming_orders'::regclass and not tgisinternal;
