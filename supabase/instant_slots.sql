-- Instant "N left" — lower the storefront counts the moment an order lands.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- ⚠️⚠️ NOT SAFE TO RE-RUN ONCE shared_pool_slots.sql IS INSTALLED (v557). ⭐ Both files define the SAME
-- function and trigger, and running this older one afterwards silently reverts the pool-aware version:
-- a value pack stops lowering its base product, and a day's count is wrong until a phone recalculates.
-- ⭐ The guard below refuses, rather than replacing a newer rule with an older one.
--
-- Why: normally the "Only N left / Sold out" numbers are recalculated by the
-- backoffice app, so they only stay fresh while one of the phones is awake.
-- This rule makes the database itself lower the matching day's and product's
-- count the instant a customer's order is placed — so the storefront stays
-- honest even overnight or if both phones are asleep.
--
-- How it works:
--   * An incoming_orders row lands (the customer tapped "Place order").
--   * A trigger reads the order's JSON (delivery date + each product + qty).
--   * It lowers `availability.slots_left` (the day pill) by the total ordered,
--     and lowers `product_availability.slots_left` (the "Only N left" stamp)
--     for each limited product, never below 0.
--
-- The backoffice app still recomputes and republishes the counts from scratch
-- whenever a phone is awake, so the two never fight: the trigger covers the
-- moments in between, and the app's full recalc always wins when it runs.
-- Best-effort by design: if anything about an order can't be read, the order
-- is still saved and the counts are simply left for the next app recalc.

-- ⚠️⚠️ AND HERE IS THAT GUARD. It reads the INSTALLED function — not this file — so it answers the only
-- question that matters: would running this file undo something newer?
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'decrement_slots_on_order' and prosrc like '%pool_base%'
  ) then
    raise exception 'This file is retired: shared_pool_slots.sql is already installed, and running this '
      'older version would revert it. Nothing has been changed.';
  end if;
end $$;

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

    -- ⚠️⚠️ A HUNDRED LINES OF A HUNDRED IS STILL AN ABSURD ORDER (v596). ⭐ The whole order's count is summed
    -- first; above a generous day (200) the order moves NO count at all.
    declare
      total_wanted integer := 0;
      t_line       jsonb;
      t_qty        integer;
    begin
      for t_line in select * from jsonb_array_elements(j->'lines') loop
        if jsonb_typeof(t_line->'qty') = 'number' and (t_line->>'qty') ~ '^[0-9]+$' then
          t_qty := (t_line->>'qty')::integer;
        else
          t_qty := 0;
        end if;
        if t_qty between 1 and 100 then total_wanted := total_wanted + t_qty; end if;
      end loop;
      if total_wanted > 200 then
        raise notice 'order % asks for % units — the counts are ignored', new.id, total_wanted;
        return new;
      end if;
    end;

    for line in select * from jsonb_array_elements(j->'lines') loop
      -- Only whole positive quantities against a real product name count.
      lname := coalesce(btrim(line->>'name'), '');
      if jsonb_typeof(line->'qty') = 'number'
         and (line->>'qty') ~ '^[0-9]+$' then
        lqty := (line->>'qty')::integer;
      else
        lqty := 0;
      end if;
      -- ⚠️⚠️ AN ABSURD LINE DOES NOT MOVE THE COUNTS (v565). ⭐ The public order form takes any
      -- non-negative integer, so a scripted POST with qty 1000000000 zeroed a whole bake day
      -- for everyone. ⭐ A real line is a few dozen pans; above a hundred the line is not an order and
      -- the counts ignore it. ⚠️ The ORDER still saves — this is a count, not a gate.
      if lqty < 1 or lqty > 100 or lname = '' then
        continue;
      end if;
      day_qty := day_qty + lqty;
      update public.product_availability
        set slots_left = greatest(0, slots_left - lqty), updated_at = now()
        where date = odate and product = lname;
    end loop;

    if day_qty > 0 then
      update public.availability
        set slots_left = greatest(0, slots_left - day_qty), updated_at = now()
        where date = odate;
    end if;
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
