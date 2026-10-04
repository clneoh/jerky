# Munchies Furkidz — backoffice for a home dehydrated-pet-treat maker

> Business name **Munchies Furkidz**; live domain **munchies.com.my** (apex). The
> exact display wording is set during go-live — search-and-replace these references
> if it changes.

A small, static web app for a solo home producer of dehydrated pet treats (working
name **Munchies Furkidz**). It turns "orders for this posting run" into an
automatic ingredient shopping list (purchase order) — no manual math. Duplicated
from the owner's bakery system (`jienluv2bake.com.my` / bakeadmin) and adapted to
pouches-by-weight pet treats posted nationwide.

- **Products** have recipes (a bill of materials: ingredient + qty per pouch).
- **Posting days** are Mon/Wed/Fri with a daily batch capacity (default 12) and an
  order cut-off at 6pm the day before.
- **Orders** are entered manually per posting day (from WhatsApp).
- **PO** (under **More → Purchase Order**) = sum(order qty × recipe qty) per
  ingredient, priced in RM. Saved snapshots are kept in PO History and can be
  printed. The bottom tabs are **Home · Orders · Products · Customers · More** —
  Customers is a tab of its own.
- **Fulfilment** is **Post (nationwide)** by default — an order takes a postal
  address. A flat **postage fee** (default RM8) is stored on the phone in
  **Settings → Storefront → Postage** and added to the *To-pay* line of her
  WhatsApp confirmations; it is **not** shown on the storefront or auto-added to
  the customer's total — she confirms the fee over WhatsApp. Collect (local) is
  still available by arrangement.

There's also a customer **storefront** (`store/`) — a public order page customers
open on their phone. They pick a posting day, tap pouches + quantity, add their
postal address and place an order; it lands **automatically** in the backoffice
order list (status *New*) for the owner to confirm. If Supabase isn't reachable it
falls back to a tidy WhatsApp message.

The site is served by one GitHub Pages repo at the custom domain
**munchies.com.my** (apex, no "www", committed in `CNAME`): the **root** is a
public homepage, `/store/` is the customer order page, and `/admin/` is this
backoffice.

Deliberately out of scope: stock/inventory tracking and online payment.

## Run locally (development)

ES modules don't load over `file://`, so serve the folder:

```bash
cd jerky
python3 -m http.server 8000
# or: npx serve
```

Then open http://localhost:8000 (homepage), http://localhost:8000/admin/
(backoffice) and http://localhost:8000/store/ (storefront).

## Deploy (free)

**GitHub Pages:**
1. Create a repo (e.g. `jerky`), push this folder to `main`.
2. Repo → Settings → Pages → Deploy from branch → `main` / root.
3. Repo → Settings → Pages → **Custom domain**: `munchies.com.my`, and tick
   "Enforce HTTPS". At your domain registrar, point the domain's DNS at GitHub
   Pages (for an apex domain like this one, add the four GitHub Pages `A`
   records; keep the `CNAME` file as `munchies.com.my`).
4. Live at `https://munchies.com.my` — homepage at the root, storefront at
   `/store/`, backoffice at `/admin/`.

**How publishing works:** after this, every push to `main` republishes the site
on its own — nothing is uploaded by hand. GitHub runs a "pages build and
deployment" workflow per push (`build`, then `deploy`), normally done in well
under a minute. If the live site still serves an old file, read that file on the
live origin (e.g. `/home.js`) before suspecting the code — if it is current, only
the newest commit is missing. The run is listed under Actions → "pages build and
deployment" (a `deploy` job stuck in progress is cleared by **Cancel workflow**,
then **Re-run all jobs**), and Pages caches HTML for ~10 minutes, so a private
window or a `?v=2` URL is the way to be sure.

**Netlify (even quicker):** drag this folder into https://app.netlify.com/drop.

Relative paths + `#/` hash routing mean the subpath URL just works.

> The live bakeries run on their own GitHub Pages + a separate Supabase project.
> This repo must keep its **own** Supabase credentials and its own custom domain —
> never the bakery's. `store/config.js` and `admin/js/state.js` carry `"FILLME"`
> placeholders; the real values are wired in after she creates a new Supabase
> project.

## Storefront (customer order page)

A second page at `store/` that customers open on their phone. Flow: pick a
posting day → tap products → choose **Post (nationwide)** and enter a postal
address (or Collect if offered) → **Place order**. The order goes straight into
the backoffice order list (status *New*), and a WhatsApp message to the business
also opens on the customer's phone — pressing **Send** delivers the copy, which
reveals the customer's own number to the owner (the order is never lost: if the
app route fails, the WhatsApp message is the fallback instead).

Pressing the button gives **immediate feedback** (button flips to "Sending…",
then a confirmation card appears with a summary of the order and whether it
reached the app — with a tappable WhatsApp link if the auto-open was blocked).
The button is **disabled while an order is being sent**, so tapping repeatedly
can't create duplicate orders.

Preview it locally at http://localhost:8000/store/.

With live Supabase configured, what customers see is edited in the backoffice —
**More → Settings → Storefront** — and published automatically (no redeploy).
That covers the business name, tagline, WhatsApp number and social links — and
the homepage's own footer rows (WhatsApp, Instagram, Facebook) read those same
published settings, so the two pages always quote the same number and handles.
A field left blank in Settings leaves the value typed into `index.html` alone,
so a half-filled Storefront card never blanks a working link. (The homepage's
contact **email** has no Settings field; it stays as typed in `index.html`.) The
**menu is the backoffice product list** (More → Products): add, price or hide a
product there and it updates on the customer page after a publish — there's no
separate storefront menu to keep in sync. `store/config.js` is only the starting
point / offline fallback.

## Live availability (Supabase)

The storefront can show how many slots are left per posting day ("4 left" /
"Sold out"), so customers pick the next open day instead of ordering into a full
one. Since the storefront is static, the backoffice app **publishes** the counts
to a free Supabase table and the storefront **reads** them live.

How it works: every time the owner adds/edits/removes an order (or changes a
day's capacity), the backoffice computes `slots_left = capacity − booked` for
the next ~10 posting days and pushes them to Supabase. The storefront fetches the
rows for the days it shows. If the feature is off or the fetch fails, the page
behaves exactly as before.

**One-time setup (takes ~10 min):**
1. Create a free project at [supabase.com](https://supabase.com) → New project
   (a **new** one — do not reuse the bakery's).
2. Dashboard → **SQL editor** → open `supabase/availability.sql` → **Run**
   (creates the table + row-level security: anyone can read, only a logged-in
   user can write).
3. Dashboard → **Authentication → Users → Add user** — this is the app login
   (an email + password the backoffice will use to publish).
4. Dashboard → **Project Settings → API** — copy the **Project URL** and the
   **anon public key**.

**Then connect the two apps:**
- Backoffice → **More → Settings → Live availability**: paste URL, anon key,
  the app login email/password, and flip *Enable live availability* on. Hit
  **Sync now** to publish immediately.
- Storefront → `store/config.js` → paste the same **URL** and **anon key** into
  `supabase`.

The backoffice stays the source of truth — Supabase only holds the published
snapshot, so a wiped table is fixed by one "Sync now".

## Storefront menu & orders (Supabase)

Two extras that build on the same Supabase project:

- **Storefront config** — the backoffice publishes the storefront's name,
  WhatsApp number and social links to a `storefront_config` table (editable in
  **Settings → Storefront**), plus the menu built from the **Products** list, so
  a WhatsApp or menu edit goes live without a redeploy.
- **Order intake** — customers' orders are posted to an `incoming_orders`
  table. The backoffice polls ~every 30 seconds, turns each one into an order
  (status *New*, tagged "storefront") and advances it New → Confirmed → Paid →
  Preparing → Packed → Delivered. A cart with several items arrives as one order
  (one row, one status, one delete), and **New orders are hard to miss**: the
  Orders tab shows a red badge and the top of the Orders screen lists every
  unread order across all posting dates.

**One-time setup:** run `supabase/storefront.sql` in the SQL editor.

Two things to know: an item is imported only when its name matches a backoffice
product (add it in Products and it'll import next time), and — since anyone with
the link can place an order — review New orders before confirming them.

## Homepage customer reviews (Supabase)

The homepage (repo root `index.html`) now carries a **What customers say**
section: the reviews the owner has approved, newest first, plus a form any
visitor can fill in — name, a 1–5 star tap rating, a message, the language they
wrote in (English / 中文 / Bahasa Malaysia), and an optional photo. Reviews live
only on the homepage, never the order page.

- A review is posted to a `reviews` table with `published = false` (public
  anon insert, like `incoming_orders`). Unpublished rows are invisible to
  anonymous readers — a `published = eq.false` query returns nothing.
- **The owner approves every review first** (nothing public without her tap):
  backoffice → **More → Reviews** lists new ones under *Waiting for you* with
  the name, stars, message, language, date and photo; **Publish** shows it on
  the homepage, **Take down** hides it again, **Delete** removes it for good.
- Photos upload to the public `review-photos` Storage bucket via the anon key,
  shrunk to **1000 px** on the longest side first (down from 1600 — the card
  renders at most 340 px tall, so this is ~a third of the bytes at no visible
  cost). Photos already stored keep the size they went up at.
- The carousel does not fetch every published photo up front: a slide's photo
  waits in `data-src` and is promoted by `loadPhoto()` when that slide is shown
  (or the one after, so a 6 s advance never reveals a blank frame). Slides a
  visitor never reaches are never downloaded.

**One-time setup:** run `supabase/reviews.sql` in the SQL editor (adds the
`reviews` table + RLS and the `review-photos` Storage bucket + policies).

## The service worker

There is exactly one worker here: **`admin/sw.js`**, the backoffice's offline app
shell, with scope `/admin/`. It is network-first, so a phone gets fresh code when
it is online and falls back to its own cache when it isn't. Nothing else on the
site registers a worker — in particular the homepage must never register a
root-scoped one, because a root worker covers the store and `/admin/` as well.

Its fallback is guarded: only a page navigation (`req.mode === "navigate"`) may
fall back to the cached `./index.html`. Everything else — a script, a stylesheet,
an image — is left to fail as itself. The earlier rule answered *any* failed
request with `caches.match(req) || caches.match("./index.html")`, which hands a
request for a `.js` file the homepage **HTML**; a browser that receives a web page
where it asked for a script silently does nothing with it, so the module never
runs and whatever it wired up goes quiet with no visible symptom. (On the bakery
that showed up as a homepage stuck in English whose EN / 中文 / BM buttons were
dead, since `home.js` never ran. munchies.com.my never had that — it has always
served its app from `/admin/`, and a service worker is scoped per origin, so the
bakery's old root worker never reached this domain.)

`test/service-worker.test.js` runs the real worker script in a stand-in worker
scope and drives its fetch handler, asserting the response to a failure as a
response rather than as a string in the source: a failed script/stylesheet/image
must come back as an error, a navigation offline must still get the cached shell,
and a genuinely cached file must still be served.

## An order is a record of a sale (price + name snapshot)

An order row is not a pointer to a product — it is a record of what was sold and
what it was sold for. Every order carries a **frozen `productName` + `unitPrice`**
written at the moment it is taken: when the storefront cart is imported
(`importIncoming` keeps the shop's own `line.price`, not the backoffice menu
price), when an order is typed in by hand, and when an edit swaps a line to a
different product (an untouched line keeps its old price). Every reader — the
WhatsApp confirmation (`confirm.js`), the payment reminder (`messages.js`), the
customer's **track page** (`trackingSnapshot`), lifetime spend (`customers.js`),
the Home estimate and the weekly numbers (`weekly.js`) — reads through
`orderLineName` / `orderLinePrice` (`state.js`), which prefer the snapshot and
fall back to the live product only for orders saved before this.

So renaming or re-pricing a product changes the shop, never history: last
month's order still reads the price that customer paid, and a deleted product
still shows what it was that someone bought. `orderLinePrice` returns **null**
(not 0) when nothing is known, so "free" and "unknown" stay distinguishable. The
one deliberate exception: the **favourite product** stat and the "what to
prepare" list stay on today's product name, because those answer an operational
question ("what do I make for them"), not a historical one.

Existing orders are stamped once by the `migratedV70` catch-up in `app.js` with
today's values — exactly what they were already displaying — so they stop
drifting. A line whose product is gone, or has no price, is left alone rather
than guessed at. No SQL — the fields live on order rows and sync/export/import
wholesale.

## Change & cancel windows, and moving an order (v73)

A product can state how much notice a customer must give to change or cancel:
**Products → Edit → "Changes or cancellations (days before delivery)"**
(`cancelDays`). It is **advisory only** — it never blocks the owner, who moves
every order by hand. The storefront reads it as data through `store/pool.js`
(`cancelDaysFor` per product, `strictestCancelDays` for a whole basket, which
returns the **largest** window so a mixed basket gives one clear figure) and
writes the sentence in EN / 中文 / BM on the product card and again on the green
order-received card. The track card deliberately stays silent: it is read days
later, when the window may already have changed. Blank = no window stated; an
explicit `0` = no advance limit. No SQL — the value rides on the product row and
the sentence is composed on the page.

An order's posting day is **changed, not deleted and re-typed** (a deletion reads
as a cancellation). The Edit-order pop-up carries a **"Delivery day"** select
(`editDayOptions`) of every day still to come plus the order's own day, and saving
calls the pure `moveOrderGroup(group, dest)` (`state.js`), which writes
`deliveryDateId` and the `deliveryDate` snapshot together and therefore heals a
group whose rows were split across dates. It re-bases the capacity guard on the
destination day (capacity derives from `deliveryDateId`, so the source frees
itself), republishes the track card — which bakes the delivery-date string — and
leaves the emptied source day for the Deliveries screen's **Del**. Soft notes
report the order's own window, warn when the new day falls inside it, say when
that day has already closed and when it is short an item; none of them block.

## Policies on the shop (v73)

**Settings → Storefront → Policies** holds the owner's own cancellation and
refund wording (`policy`, `policyZh`, `policyMs`). English is the source; the
Chinese and Malay boxes are filled by the v66 `translate.js` machinery on demand
and are hand-editable, and typing over a box makes it the owner's for good. The
shop renders it under **Track your order** in the visitor's language, preserving
the line breaks as typed — `textContent` plus `white-space: pre-line`, never
HTML. Blank hides the section. It rides inside the existing `storefront_config`
data, so there is no SQL and no schema change.

## Suggesting a value (`suggest.js`, v73–v77)

Wherever an empty field shows the app's greyed recommendation, the **right
arrow** — or a tap on the small arrow drawn at the field's right edge, for a
phone with no arrow key — accepts it as real text, the same gesture as an AI-chat
prompt. A field opts in with `data-suggest="<value>"`; `installSuggestionAccept()`
is called once on `document` in `app.js`, because pop-ups and dialogs live outside
`#view`. It is deliberately opt-in: the Supabase email / key / password and
sign-in fields carry no `data-suggest`, pinned by `test/suggest.test.js`, so a
made-up credential can never be arrow-accepted.

`acceptSuggestion` fires bubbling `input` + `change` so the view's own handlers
run exactly as if typed, and marks the event `suggested = true` so the v66
translation-provenance rules do not freeze the line as hand-written. It does
**not** focus the field (v74): focusing opened the phone's keyboard, which shrank
and panned the page and left the drawn arrow somewhere other than where the thumb
landed, so the second tap of a session died. The tap strip is
`clamp(30, width*0.28, 52)` px, and a tap counts if it lands in the strip by
**either** the field's own `offsetX`/`clientWidth` reading or the page's
`clientX`/rect reading — a deliberate OR, so the rule can only accept a tap the
old one refused, never refuse one it took. A delegated `click` sits beside
`pointerdown` as a second path for browsers without pointer events.

On a product, the translated-text card (v76) now starts shut and folds on a tap
outside; each empty line shows its translation as an ordinary greyed suggestion
whose → swaps to a **↻** that re-translates just that one line, and the card's
hint reads "…if blank, it will be filled with English" (v77).

## Order-screen & calendar polish (v75, v78)

- The green **hit glow** on an order jumped to from the New Orders inbox (or from
  Find an order) used to fade on a short timer. It now loops
  (`hit-glow 1.4s ease-in-out infinite`) and is cleared only when the pointer
  reaches the row — `pointerenter` / `pointermove` / `pointerdown` / `mouseenter`
  / `touchstart`, each a self-removing listener. Under `prefers-reduced-motion`
  the ring holds steady instead of pulsing, so it still waits for you.
- The inbox tap itself uses the shared `revealOrderRow(root, group)` in
  `views/orders.js`: open the day, flash the row and **centre it on screen**,
  clearing any status filter on the way so a narrowed list cannot hide it.
- Delivery Dates relabels **"＋ Add occasion"** → **"＋ Load standard occasions"**
  and the in-window **"Add"** → **"Add my own day"** (v78), so the only plain Add
  in that window is the one that files the ticked days.

## Calendars: picking a day, a product's sell days, published holidays (v79–v88)

The shop and the app now speak one calendar language. A day is picked from a
**month grid** — one month at a time, arrows either side of the month name — not
a row of date chips, and a marked day wears the same shape on both sides.

- **The customer picks a posting day on a month calendar** (v79) — under *Pick a
  posting day*, open days are ringed green, every other day is plain and not
  tappable, and the chosen day is written out under the grid
  (*"Your posting day: Wed, 16 Sep"*). The first open day is pre-chosen, so
  ordering can never be blocked by forgetting to tap. Cut-off and full days
  behave exactly as before. The same calendar stands behind the app's date
  controls — the **＋ New order** card's posting-day picker, the Edit pop-up's
  **Delivery day**, and the **Order date** boxes — via `admin/js/datepicker.js`
  (it expands in place rather than opening a window, because the app's pop-ups
  share one layer). The Orders screen's own date strip is the same month
  calendar, ringed green with **booking counts** (`3/12`, or **FULL**) and a red
  count once a day has closed (v80).
- **A product's sell days are marked on its own calendar** (v82) — the
  **Availability** card in a product's editor (folded by default; its title says
  what is marked, e.g. *"Sat & Sun"* or *"1-24 Dec 2026"*). Tap a weekday letter
  to mark every one of that weekday **in the month shown**; tap a day; drag a
  run; tap or drag again to unmark. Marks never carry into another month, and a
  listed mark's **Starts**/**Ends** can be stretched across months or years (a
  blank end means "from here on" / "up to here"). A product with no marks sells
  on every posting day. On the shop, a day a product is not sold for **does not
  show the product at all** (no card, nothing to want and not have) — the one
  exception is the notice period (`closeDays`), which is a *different* question:
  the product IS sold that day, only ordered earlier, so it stays with its note.
  The old *From/To* season boxes became one such mark on first open, so nothing
  set before is lost.
- **Holidays are drawn, and publishing one is part of the same save** (v79,
  v81, v83) — days loaded from the standard occasion list (Delivery Dates →
  **Load standard occasions**) are published with the storefront, so the shop's
  calendar tints them (v79/v81) and marking one **republishes within a couple of
  seconds** (v83) rather than waiting for some later save. Only a day that is,
  by name and date, one of the built-in standard days is ever published: a day
  the owner typed herself stays private to her phone. A mark never adds or
  removes a posting day and never changes what a product sells. (Existing marks
  need one **Publish now** tap in Settings → Storefront to catch up.)
- **One shared drawing module, one wash everywhere** (v84–v88) —
  `admin/js/occgrid.js` draws a marked day on every app calendar (Orders, the
  date pickers, Delivery Dates, a product's Availability), and `store/calendar.js`
  is the shop's own copy of the grid helpers with a **drift guard** in
  `test/store-cal.test.js` pinning the two copies' mark rules together. A mark is
  only ever a **see-through wash** (depth = how long the run is, one-day deepest),
  never a solid block, so a date number and the green posting pill always read on
  top; on the Orders screen the tint sits on the line of dates (v88). Tapping a
  marked day **names it** with the same bubble the shop shows (v87); on a computer
  resting the pointer names it too, while a phone keeps the tap (v88).

The one shared root module is `availability.js` — the pure sell-day rules
(`sellOpen`, `ruleOpen`, `normRules`, …) imported by both trees (`admin/js/state.js`,
`admin/js/supabase.js`, `admin/js/views/products.js`, `store/app.js`, `store/pool.js`).

## Delivery dates, the keep-listed switch, and folding cards (v89–v92)

- **The Delivery dates screen is the calendar alone** (v89) — the "dates still to
  come" list is gone, because the grid already draws every one of them as a green
  tick and now lets the owner take any of them back: **tapping a ticked day
  removes it**, asking first (`confirmDialog`) only when orders sit on that date
  (the orders are kept; only the date goes). Dates already past keep their tick
  but are not tappable, and gather into one folded **Past dates (N)** group — all
  of them, where the old list showed only the ten most recent.
- **A product can stay on the shop when it cannot be ordered** (v90) — the
  **Availability** card opens with a keep-listed switch (`alwaysListed`, a real
  `<input type="checkbox">` dressed as a switch). Off is the default and an
  absent key is off, so a product the owner never opens publishes byte-for-byte
  as before. On, the card stays on a day the product is not sold instead of being
  dropped by `renderMenu`, stamped **Unavailable** (`t("unavailable")`) with its
  existing reason and a new line naming the **next date it can be ordered** —
  `nextOrderable()` in `store/pool.js`, which also reports how many are left that
  day when a daily limit publishes a count. A sold-out card keeps its **Sold out**
  stamp and gains the same line. The folded card title carries `· kept on the
  shop` so the state reads while the card is shut.
- **The Orders calendar answers a tap it cannot act on** (v91) — `deliveryCal`
  takes `noteMisses` (on at the Orders screen, the ＋ New order card and the Edit
  pop-up's day picker). A plain day now renders as a `<button class="… tappable">`
  and writes a `.cal-miss` line under the grid: *"Sun, 20 Sep is not a delivery
  day. Add it in More → Delivery Dates."* A day already gone stays a silent
  `<span>`, and opening a real day clears the line — the grid repaints before
  handing off to `onPick`, so it never relies on the caller to tidy up.
- **The New product card folds** (v92) — a module-level `newFormOpen` flag (a
  node cannot hold it: the card is rebuilt on every change around it) keeps the
  form open across a repaint and after a product is added, while a fresh visit to
  Products starts it folded to **＋ New product**. Same fold-head/fold-body/outside-tap
  wiring as the ＋ New order card.

## The cut-off time, in words (21 Sep 2026, no engine bump)

The order page's info card read **"Order by 18:00 the day before"**. It now reads
**"Order by 6pm the day before posting"**, and the rest of the page agrees with it.

The app still *stores* the cut-off 24-hour — Settings' box is an `<input type="time">`, and
`isOpen` parses `HH:MM` — so this is display-only. `store/app.js` gains `clockWords(cutoff,
lang)`, which turns `"18:00"` into `6pm` / 晚上6点 / 6 petang and hands anything that is not a
24-hour time back untouched rather than guessing at it, and **all three** places the page names
the deadline go through it:

- `beforeVal` — the info card ("Order by 6pm the day before posting"; `store-lang.js` gained the
  word *posting*: 发货日前一天%1前 / "%1 sehari sebelum hari pos").
- `madeToOrder` — the hero eyebrow ("Made to order · closes 6pm the day before").
- `confirmClosedBody` — the note a customer gets when the page was left open across the deadline.

`lang` is a parameter (defaulting to `loadLang()`), so the words are asserted in all three
languages in `test/store.test.js` without a phone. Manual **v132a** (a manual-only revision —
the engine did not move).

## The homepage grid: prices and card copy (23 Sep 2026, no engine bump)

The homepage's treat grid is **static marketing copy**, not the live menu — the shop's own
products live in the backoffice and are published to `/store/` (see the single-source rule). So a
card's price is a literal in `index.html` and its wording is a key in `home-lang.js`; neither is
read from Supabase, and nothing on the admin side changes a homepage card.

Three things follow, and all three bite:

- **A price lives in the markup only.** `<div class="price">` carries the RM figure as plain
  text — there is no `data-i18n` on it, because a number reads the same in all three languages.
  Prices are therefore *not* in the language dictionary and cannot be translated.
- **A description lives in the dictionary, in three languages.** Its English value must
  byte-match the authored text in `index.html`: `test/i18n.test.js`'s "English dictionary values
  match the authored English text" walks every `data-i18n` tag in the markup and asserts
  `HOME.en[key] === authored`. Edit one side and not the other and the suite fails — which is the
  point of the test, and why a copy change is always two edits.
- **`test/i18n.test.js` also asserts key parity**, so a new key (`p10Tag` for the out-of-stock
  pill) must exist in `en`, `zh` and `ms` or the homepage test fails before the browser ever sees
  it.

**Out-of-stock is the existing `.soon` pill, not a new mechanism.** The grid already had a pill
beside a product name (`porkTag`, `.eyebrow .soon.pork`); Egg Yolk Melts reuses the same shape with
an `.oos` variant in the same muted brown as the `.size` line, so "cannot be ordered right now"
does not read as a flavour tag. Its price was on the card until 26 Sep 2026, when the owner asked
for it to be removed — the card now carries no figure at all (see **Prices** below).

**The Full/Short pair.** The owner supplied a full paragraph and a one-line summary per treat.
Her instruction was the **full** description on the homepage, so the short lines are unused here;
they are not deleted, and are the natural copy for a smaller surface (the shop menu's product
description, or a printed label) if she asks.

**Units and sizes (later the same day).** Every card's size line is a `data-i18n` key like
`p1Size`, so it obeys the same two-sided rule as a description: the markup and `HOME.en` must
match byte for byte. Three treats now sell in two weights — Chicken, Duck and Pork Jerky read
`50/100g pack` in English, `50/100g pack` in Malay (**`Pek 50/100g`**) and the Chinese word for a
pack rather than a bag, since the site says "pack" rather than "pouch". The unit word on the
homepage is **not** the product `unit` field the backoffice holds: `pouch` still legitimately
appears in admin fixtures (`state.test.js`'s `PETTREAT` list, `uom_pouch`) and is deliberate —
that is the live menu's own vocabulary, a separate copy surface that this change did not touch.
A second size did **not** imply a second price at the time: each card carried one literal RM figure.
That changed on 26 Sep 2026 — see **Prices** below.

**Prices (26 Sep 2026).** A price is a literal in the markup and nothing else — no dictionary key,
no test, no Supabase read — so changing one is a **one-sided edit**, unlike a description or a size.
Seven cards changed: Puff, Biscuit, Pear Roll and Chinese Yam Chicken to **RM25**, and the three
jerky to their 100g figures. Apple and Okra stayed at RM24.

Two details worth keeping:

- **`RM24` is a shared literal, not a unique one.** It sat on seven cards at once, so a
  `replace_all` would have re-priced the wrong treats; every edit is anchored on the neighbouring
  `data-i18n="pNSize"` line, which *is* unique per card. Keep doing that.
- **A two-price card needs `.price-two`.** `50g RM16 · 100g RM29` measures ~302 px at the `.price`
  size of 28 px, but the price box caps at ~251 px (55 % of a 550 px card, less 25 px padding), so
  at full size it wraps onto a second row and pushes that card's description down. The modifier
  sets 22 px, which fits on one line at every width. A single-figure card keeps 28 px.

Egg Yolk Melts carries no `.price` element at all now; its `.size` line is followed directly by the
description.

**Pear Chicken Roll went back to RM24 on 27 Sep 2026** — the one card the owner revisited, and a
reminder that "the 26 Sep list" is a snapshot, not a standing rule. The fix was the figure alone:
its size line already read `50g pack`, so nothing else on the card moved.

## The shop's calendar answers a tap it cannot act on (21 Sep 2026, no engine bump)

`buildCalendar()` in `store/app.js` builds a `<button>` for a day the customer can do something
with and an inert `<span>` for every other day — so a future day that is not one of her posting
days swallowed the tap completely: no highlight, no message, nothing. It now answers with a line
under the grid (`.cal-miss`), styled like the backoffice's own v91 `.cal-miss` so the two
calendars read alike. A whole sentence goes in a line under the grid rather than in the bubble
over a day: a bubble is a word or two wide, and a sentence at the edge of a phone would run off
the screen.

**Two sentences, because there are two facts.** This is the part worth remembering:
`upcomingDates()` starts at tomorrow and `dates` is filtered through `isOpen`, so **today is
never on the list and a posting day vanishes the moment its 6pm deadline passes**. Both are days
she really does post — the info card above the grid names them as posting days — so "not a
posting day" would have contradicted the same screen daily. `dayAsk(cfg, dayRows, d, spec, now)`
is the pure decision, exported so it can be pinned against fixed dates:

| situation | `dayAsk` | the line |
|---|---|---|
| a day she does not post | `"miss"` | *"Tue, 22 Sep is not a posting day — please pick a green day."* |
| a day she posts, window shut | `"closed"` | *"Orders for Mon, 21 Sep have closed — please pick a green day."* |
| a day she posts, window open, not offered | `null` | nothing — neither sentence would be true |
| a day with a spec (open, or Sold out) | `null` | nothing — a Sold out day is already named |

`postsOn(cfg, dayRows, d)` decides the first branch: a configured posting weekday, **or** a date
the backoffice published (an extra Thursday she added by hand). `now` is a parameter, so the
branch is testable without moving the clock.

Choosing a green day clears the line (`missIso`/`missClosed` have the bubble's lifetime), it
returns null again if the day later gains a spec, and a past day is asked nothing at all — a past
Monday *was* a posting day, so the sentence would be a lie on it. The line is deliberately **not**
cleared from the module's `pointerdown` listener: a phone scroll begins with a pointerdown, which
would wipe the sentence the moment the customer moved the page to read it. Manual **v132b**.

## The courier charge, and the postage it replaces (v124–v130, v132)

One theme, seven versions, all code-only apart from two small SQL scripts. An order
gains a **courier charge** (`order.courierFee`) and **who bore it**
(`order.courierPaidBy` = `"me"` | `"customer"` | `""`), plus a **COD flag**
(`order.courierCod`). `admin/js/courier.js` is the whole reading of it.

### The reconciliation rule — this app's own, not the bakery's

The bakery has no storefront postage fee, so its per-order charge and this app's flat
RM8 were two answers to one question: ported verbatim, a posted order would quote
**two** delivery lines in the same WhatsApp message. The owner ruled on 20 Sep 2026 —
*"Charge replaces postage"* — so:

- **any recorded charge replaces the flat postage** — a customer-borne one stands in for
  it on their total, never both;
- a charge she bore is a `Delivery & fuel` **expense** and the customer owes **no**
  delivery charge at all — the flat fee goes with it, which is what makes that mode the
  way a goodwill order absorbs the postage;
- an order with **no** charge recorded is quoted exactly as it was before this existed.

`customerTotal(state, group)` returns `{ items, courier, cod, postage, total }` where
`total = items + courier + postage` and **COD is excluded** — the courier takes that
money at the door, so including it would ask for the same money twice.
`postage = recorded ? 0 : flatPostage(state, first)` is the rule in one line, where
`recorded` means a positive `courierFee` **and** a named `courierPaidBy`, and
`flatPostage` returns 0 for a `collect` order. The payer is part of that test on
purpose: keyed on the customer's share instead (as it was first written), the she-bore-it
mode silently re-added the flat fee and a parcel she had just absorbed still asked for
RM8 — found live in the sandbox on 20 Sep 2026. A half-filled box (an amount typed with
the payer left at "Not recorded") is deliberately *not* yet a charge, so an unfinished
entry can never take the delivery line off an order. Routing the messages, the Money
screen's "still to collect" and the published track-card total through this one helper
also fixes
an inconsistency this app had before the port: the card and the Money row counted the
items alone while the WhatsApp asked for items **plus** postage.

### Where each half lands

**Customer-borne** → added to their total, named in their messages
(`confirm.js`, `messages.js` via `courierAddUp`) and drawn on their track card as
`.track-no`'s neighbour `.track-fee`. **She-borne** → one ordinary `state.expenses[]` row
(`courierFor: <orderCode>`), which reaches Money and Profit through the existing
machinery; `journalFor`'s row label reads `Courier (order #X)` so a figure she cannot
place is openable under its own name. `applyCourierCharge(state, group, fee, paidBy,
method)` is idempotent, keyed on the order code, and returns
`"created" | "updated" | "removed" | "none"`; `clearCourierCharge(state, code)` removes
it and returns the group so the caller can republish that customer's card — which is how
deleting the `Delivery & fuel` row on the Money screen takes the charge off the order
with it.

### The card republishes whenever anything it shows has moved (v132)

The phones always agreed — an order is a synced record — but the customer's track card
was published only when the day, the tracking number or the charge moved, so an edit to
the items, a price, the address or the name left the card quoting the order it used to
be. The field list was the defect, so the fix is not a longer list: `cardContent(row)`
strips `updated_at` and JSON-stringifies the whole row, a module-level
`const published = new Map()` remembers what **this device** last published per code, and
`pushTracking` records only on `res.ok` — so a write the server refused (a missing
column, i.e. a SQL script not yet run) is **retried** rather than remembered as done.
`forgetPublishedCards()` is the test seam.

### Two SQL scripts, and the order matters

`supabase/courier_fee.sql` and `supabase/courier_cod.sql` — `alter table order_tracking
add column if not exists …`, one paste each, **both before deploying**. The backoffice
publishes a customer's whole tracking row in a single call, so a missing column rejects
that call **as a whole**: every customer's card stops updating, not only orders carrying
a charge. Idempotent, so a repeat is harmless. A commit or a push runs no SQL.

## The big sync: production, couriers, maps, categories (v133–v223)

Ninety engine versions in one pass, from bakery HEAD. Two things make this sync different
from every earlier one.

**It reverses the one divergence.** On 2026-09-20 this repo deliberately stopped at v132 and
left the bakery's **Production line** behind — the first and only time the two apps differed,
because the bakery's tool was bread-specific and she said she did not need it. She has since
changed her mind and asked for it after all: **"Port it exactly as it is"**. So the Production
line, the Scenario planner and the bake-day board are here now, **in the bakery's own words**
(ovens, pans, dough, mixers, bake days) — a deliberate choice, not a missed localization. What
transfers is the arithmetic underneath: how many of anything a day can make, given the people,
the machines and the hours.

**It excludes the v199 money redesign.** The bakery now derives a `Items total:` subtotal by
subtracting the courier's charge from the published total. On jerky the flat RM8 postage also
sits inside `total` and is deliberately never published, so a derived subtotal would be RM8
too high on every order. jerky keeps its own money lines (`moneyLines()` in `js/courier.js`).

### The two new module families

`js/production.js` and `js/scenario.js` are pure and DOM-free. A **module** is a station —
equipment *and* the pair of hands tending it, as one unit, which is why the same machine is
one person's job or two depending only on when it starts. A **batch** is one lot through it; a
**cycle** is one piece of that batch's process. The model's one idea: a line's capacity is its
slowest station, and a day's capacity is that limit held for the hours she will actually work.
`js/bakeday.js` works a bake day **backwards** from the oven moment.

`js/couriers.js` is the **registry**, and `js/views/courier_quote.js`, `js/courier_job.js`,
`js/courier_place.js`, `js/place_map.js` and `js/views/delivery_run.js` are the courier work:
price a job, book it, follow it, and build a multi-stop run. **The provider seam is enforced by
test**, not by convention — `test/courier-provider.test.js` walks `admin/js` and
`supabase/functions/courier`, strips comments only, and fails if any file other than the
registry and the provider itself contains the courier's label, case-insensitively. A string
literal in a screen counts as a leak. So the Settings card and the Guide route the name
through `courierLabel()`. The guard does not cover `marketing/`, so the manual names the
courier once.

### Product categories and photos

`js/productCategories.js` holds the tree. The record is **flat with a `parentId`**, not a
children array, because the cloud sync carries whole records keyed by id; sibling order is a
stored `sort` number, never the array position; membership lives on the product
(`product.categories = [catId, …]`, first = the heading it is listed under). A category carries
its own `nameZh` / `nameMs` — no new translation code was needed, because it reuses the same
six copy keys and provenance flags a product uses.

`js/views/products.js` gained a photo picker for the product thumbnail, reached as
`readPhoto(f, cb, 360)`. **v224 deleted the separate `readPhotoFit` it had at first** — there is
one reader for everything now, and a square is what it makes. A shop with no categories is drawn
exactly as it always was: one plain list, no headings. An empty heading is dropped, but a heading
whose own products have all sold out today is **kept**.

### The shop's address, pin and map

`store/geo.js` holds `placeForOrder(pin, fulfillment, address = "")` — a courier order gets
`{lat, lng, label}`, no address gives `{lat, lng}` only, and a non-courier order returns
`null`. `store/pin_map.js` is the map the customer drops a pin on, `store/lookup.js` is the
address lookup, and **both sides import the root `storefront-fields.js`** because the two
whitelists build fresh objects field-by-field — a field written by one and not copied by the
other is dropped with no error at all.

`store/lookup.js` is the shop's only new file with a `fetch`, and it asks **her own** Supabase
function (`supabase/functions/shop-geocode`) rather than a public geocoder directly — her
decision, *"Through your own Supabase."* Nothing is asked while somebody is still typing: a
pause, a whole address, one ask.

### The postage switch

Her mid-sync request. `settings.storefront.postageMode` is `"flat"` (the default, and how it
starts) or `"quote"`, with a `postageModeSet` gate exactly like the tasks list — a phone still
at the default must not overwrite the value she set on another phone. The switch sits at the
top of **Settings → Storefront → Postage** and reads *"Quote each posted order by courier
instead of a flat fee"*. Switched on, the fee box greys out (the figure is kept, not lost, so
switching back quotes it again) and the customer is told in words that postage is quoted
separately — on the shop, in the confirmation and on the track card — rather than being quoted
a figure that would look like the whole cost. **Nothing about an already-taken order changes
when the switch is flipped**; only orders taken afterwards follow it.

### SQL and Edge Functions

Four scripts, all idempotent, all one paste each in the SQL editor, **all before deploying**
(the backoffice publishes a whole tracking row in one call, so a missing column rejects the
call as a whole and *every* customer's card stops updating):

- `supabase/courier_fee.sql`, `supabase/courier_cod.sql` — the courier charge and cash on delivery
- `supabase/courier_job.sql` — booking a courier job through the app
- `supabase/postage_mode.sql` — `order_tracking.postage_quoted boolean`, the switch above

Two **optional** Edge Functions, in her own project so the request goes out under her own name:
`supabase/functions/courier` (price and book a job) and `supabase/functions/shop-geocode` (the
address lookup). Neither is needed to sell, and **both are deployed as of 2026-09-28** — see
the next section for what the `courier` deploy did and did not turn on.

## The backoffice address lookup, and the deploy that turned it on (28 Sep 2026, no engine bump)

Her report was **"the courier setup in other like not functioning with the geocode and no auto
complete"** — the backoffice address box did nothing and drew no suggestion list. One cause, two
symptoms. The shop (`/store/`) calls `shop-geocode`; the **backoffice calls the `courier`
function** (`callCourier(state, { action: "geocode" })` in `admin/js/couriers/api.js`), and that
function had never been deployed — parked along with Lalamove. So the lookup 404'd *and* the
suggestion panel (`admin/js/place_map.js`, `.sugg-panel`) had nothing to draw. The UI was real;
it was being fed by a dead channel.

**The deploy fixes it without committing anyone to Lalamove**, because the function answers
geocoding **before it looks up a provider**:

```ts
if (action === "geocode") {           // index.ts ~line 114
  const out = await geocodeAddress(String(args.address || ""));
  return json(out);
}
const found = configFor(provider);    // ~line 119 — the only reader of LALAMOVE_KEY/SECRET
```

`configFor()` is the only place `LALAMOVE_KEY`/`LALAMOVE_SECRET` are read, so the geocode half
needs **no courier key at all**. She ran
`supabase functions deploy courier --project-ref ircwozniiyywsowamixy` herself; `WARNING: Docker
is not running` is harmless, and **no `--no-verify-jwt`** — the gateway's JWT check passes the
owner's session token (unlike `shop-geocode`, which the shop calls with the anon key alone). The
price/book half stays unset and says so.

**Two things that look like faults and are not.** The backoffice lookup requires the phone to be
**signed in to shared data** — `channelProblem(state)` returns *"Shared data is not set up on this
phone…"* / *"…is not signed in…"* otherwise. And the suggestion list **only draws with two or more
matches** — `paintSuggestions()` opens `if (found.length < 2) { hideSuggestions(); return; }` — so
now that the Google key returns one precise house-number answer, most lookups legitimately show no
list and the pin simply lands.

## Sixteen versions in one pass: the journals, the invoice, the shop's offer strip, and code labels (v282–v297)

Bakery `81dbab6` (v281 — exactly where jerky sat) → `4bf08a2` (v297), ported with the same
one-file three-way merge per file: `git merge-file -p --diff3 <jerky> <bakery@81dbab6:file>
<bakery@4bf08a2:file>`. **61 files, 6,557 insertions. Fifteen conflicts across six files, every one
of them the usual localization** (`home-lang.js`, `index.html`, `CHANGELOG.md`, `admin/js/referrals.js`,
`admin/js/supabase.js`, `admin/js/views/profit.js`); `store/app.js` merged clean. Suite **2535 → 2664
pass / 0 fail**; every changed module ESM-parsed.

**What each version brought, oldest first.** **v282–v283** a **journal** for any money screen — print
it, or Share it as a PDF file (`admin/js/journal.js`, `admin/js/pdf.js`, new); **v284** a long
courier link wraps inside the customer's card instead of running off it; **v285** the shopping list
can be corrected at the shop, and an ingredient keeps its **price history** (`admin/js/prices.js`,
new); **v286** a **suggested promo code** you can read off a card; **v287** every code gains a
**label** (the words printed beside the QR), and printing no longer freezes an offer; **v288** how
many times each **label's link was opened**; **v289** a **named reward** on a customer, and a code
that names its person; **v290** you can **add a customer yourself**; **v291** a reward is counted, and
you can record that you gave it; **v292** and **v295–v297** the shop's **offer strip** turns through
the offers instead of hiding them behind each other, holds the height of the **tallest** message so
the page stops jumping, and turns as a real 3D flip with one **dot per offer** — the pointer being
over the strip is now the whole of the pause, so moving the mouse away always starts it again;
**v293–v294** an **invoice** for a customer (`admin/js/invoice.js`, new), one order at a time, and the
invoice number is the order's own code.

**The one database step.** `supabase/promo_visits.sql` — one paste in the SQL editor **before**
pushing, or the label open-counts the new Promo screen reads will simply not appear. Nothing else is
new: no Edge Function, no key.

**Localization.** `admin/js/journal.js` fell back to the name *"Jienluv2bake"* → **"Munchies
Furkidz"**; `admin/js/views/promo.js` had the bakery's domain hard-coded in two QR links →
`munchies.com.my`. The new changelog entries were localized (bake day → posting day, baker → you,
the bakery → your shop). `home-lang.js` and `index.html` kept jerky's own homepage throughout — the
bakery's edits to them were its own content (bake days, Sungai Ara, the Lalamove area), which jerky
replaces with its own.

**One bakery file deliberately NOT taken:** `test/store-track-money.test.js` (bakery-only — it
asserts a money block jerky's shop deliberately does not draw, since jerky's flat postage is never
published).

## One version: the profit statement says which kind of cost it is showing (v281)

One engine version, from bakery `290c14d` (v280 — exactly where jerky sat) → `81dbab6` (v281).
**Code-only — no SQL, no Edge Function, no new secret, nothing to run on the phones.** One source
file (`admin/js/views/profit.js`), a comment block, one new paragraph and a reworded footer; plus
`admin/js/version.js` → `281`, one test in `test/profit.test.js`, and this record.

Ported with the same one-file three-way merge against the bakery's own v280 blob. One conflict, in
the footer line, and it was the localization: the bakery's rewrite dropped the clause jerky had
relabelled ("what the making cost, from your recipes — so"), and the incoming sentence carries two
bakery words jerky does not use — **"bread"** and **"deliver"**. Resolved to jerky's vocabulary:
*"…becomes cost of sales as the **treats** made from it are sold. Sales are counted by the day you
**post**."* The new Gross-profit note is bread-neutral and was taken verbatim. Audit: the merged file
differs from the bakery head in exactly **8 lines — the four localizations jerky already carried**,
the same count as its divergence from the base, so nothing leaked and nothing was dropped.

**What it says.** Cost of sales is a **recipe** cost, read from the recipe and the ingredient prices
*as they stand today* — so editing either one moves a month that has already closed. The screen now
says so where the figure is, in the quiet grey under **Gross profit**, and sends her to the Money
screen for the cash. The bottom footer was reworded so the two do not repeat each other: a pack
bought today is cash on the Money screen and stock on the shelf, becoming cost of sales only as the
treats made from it are sold. **No figure moved.** Suite **2677 → 2678 pass / 0 fail**.

## Twenty-one versions in one pass: promo codes, the printed card, and the money in one column (v260–v280)

Twenty-one engine versions, from bakery `ac2d06e` (v259 — exactly where jerky sat) → `290c14d`
(v280). **One SQL script, and two Edge Functions to re-upload.** Diffstat on the bakery side
`9615 insertions, 206 deletions` across 58 files; the port lands as `admin/` + `store/` + `test/`
changes here, with nothing in `marketing/` but rebuilt PDFs.

Ported with the standing method — one cumulative three-way merge per file, never `cp` +
`git apply --reject`:
`git merge-file -p --diff3 <jerky-file> <bakery@ac2d06e:file> <bakery@290c14d:file>`.
Sound because jerky's files are bakery@v259 plus localization deltas, so the bakery's v259 blob is a
true common ancestor. Each merged file was then audited by the matched-divergence rule: `diff merged
-vs-jerky-original` and `diff merged-vs-bakery-head`; when the head difference count equals jerky's
base difference count, the merge added the bakery's changes, kept jerky's divergences and leaked no
bakery identity.

`admin/js/version.js` is now `280`. Suite **2677 pass / 0 fail**.

### The one database step, and the two deploys

- **`supabase/promo_track.sql` must be run BEFORE this build reaches a phone.** It adds
  `order_tracking.promo_code` and `order_tracking.promo_rm`. The backoffice publishes a customer's
  **whole tracking row in one call**, so one unrecognised column rejects the call as a whole — every
  customer's track card stops updating, not only the orders that carried a code. Same trap
  `courier_fee.sql` documents. Idempotent, so running it twice is harmless.
- **v260 changes both Edge Functions**, so `wish-mail` and `shop-feedback` must each be re-uploaded
  — a push does not do it. Run `supabase functions deploy <name> --project-ref ircwozniiyywsowamixy`
  **from the repo folder**, and prove it with `supabase functions list`. `RESEND_FROM` beats the code
  if that secret is ever set, so check `supabase secrets list` too.
- **No new secret.** `shop-feedback` and `wish-mail` keep reusing `RESEND_API_KEY` and the verified
  `send.munchies.com.my` domain.

### The new files

| File | What it is |
|---|---|
| `admin/js/promo.js` | The code engine: `normalizeCode`/`normCode`, `findCode`, `offerOf`, `worthOf`, `minimumOf`, `shortfallOf`, `stoppedBy`, `evaluate`, `publishCodes`, plus the printed-card freeze (`frozenProblem`). Pure data — no DOM, no storage, no clock — so the shop and the backoffice judge a code with exactly the same rules. |
| `admin/js/promo-usage.js` | `usageByCode(state)` — what each code has done so far, **recounted from her own orders** every time it is asked, never read off a tally that could drift. A basket counts once. |
| `admin/js/promo-card.js` | The printed card's pure data (`cardFields()`) and its page (`renderCard()`, `boot()`). Four identical cards on one A4 sheet, no end date and no count on the paper. |
| `admin/js/views/promo.js` | The **Promo codes** screen under More: the eleven-step life of a promotion, Pause / End, the ceiling box, and Print it. |
| `admin/promo-card.html` | The print-sized page the card is drawn on. |
| `supabase/promo_track.sql` | The two `order_tracking` columns above. |
| `store/fonts/` | ShantellSans (regular, latin subset) and its OFL licence — the shop's own "chalk" hand, **inside the shop's folder**, so nothing is fetched from a font company when a customer opens the page. |

### The two bakery files deliberately NOT taken

- `admin/js/qr.js` and `test/qr.test.js` — the bakery's QR encoder is a **new** file in this range,
  but jerky already has its own (`admin/js/qr.js`, from the taster/QR-label work, exporting
  `qrMatrix`/`qrSvg`/`qrPngBytes`). The bakery's `qrSvg(text, opts)` takes **text**; jerky's
  `qrSvg(matrix, opts)` takes a **matrix**. `promo-card.js` calls `qrSvg(qrMatrix(url), …)` — the
  jerky-local adaptation — so the card works without either file being swapped.
- `test/store-track-money.test.js` — bakery-only, and it asserts the bakery's own money block on the
  track card, which this shop deliberately does not draw (see the v277 row below).

### The versions

| Version | What it bought |
|---|---|
| **v260** | Both Resend mails are sent under the shop's own name (`Munchies Furkidz`), not the app's internal one. Taken from the homepage `<title>`; a new `test/email-sender-name.test.js` derives the expected brand so a rebrand fails the test. **Deploy step.** |
| **v261** | Every admin calendar greys a past day in the shop's own flat grey. Ported **below** jerky's own `.cal-cell.off` rule, since jerky's `.past` sits above `.off` (the bakery's is the other way round). |
| **v262** | The one-declaration completion: `.cal-cell.off`'s `opacity: .6` is dropped, so the past is genuinely one shade and a quiet day is readable. **Ported with v261 and v263 as one piece** — v261 alone is a half-fix. |
| **v263** | `.cal-cell.off`'s colour moves to a solid contrast (the ratio, not the hex): a quiet day clears 6:1 against the card while staying a full ratio point lighter than `--ink`. |
| **v264** | A tap on the map no longer moves the pin; only dragging it does. **Kept**: a tap still places the first pin on an empty map, and the shop's customer map is untouched (for a customer the map is often the only way to place a pin at all). |
| **v265** | The consignment box belongs to a parcel, so it is drawn with the parcel and not left empty under a finished delivery price. Ported **with `consignmentWhere`'s default `"above"` intact**, which keeps the Edit and Note/tracking pop-ups byte-identical. |
| **v266** | A button says what happens if you press it **and** what happens if you don't. Moves `store-lang.js`'s `pinHint` in all three languages **and** the inline English at `store/index.html:74`, which `test/store-i18n.test.js` forces to equal `STORE.en.pinHint` exactly. |
| **v267** | A courier charge goes quiet (parked, not deleted) while the order is a Self collect. |
| **v268** | Five places that disagreed with each other after v267: the published tracking snapshot no longer hands a self-collect customer a driver, plate, phone or waybill; a parked charge no longer counts against a booked trip; Cash / TNG records the payment and not just the method; Print label runs from Baked to the end; and a confirmation goes green only after **I have sent it**. |
| **v269** | Promo codes, first slice: the **Promo codes** screen, the shop's **Have a code?** box, and the standing offer line. The total on the shop page never moves — the code is a note that travels with the order. |
| **v270** | The code becomes visible: an amber code tag on every order row, the shop's line names the whole offer, and the code screen becomes full (who / when / smallest basket / how often / what it cannot sit with / who can see it). Nine plain reasons the shop will not take a code. |
| **v271** | A code knows when to stop: **Stop after giving away (RM)**, counted fresh from her own orders, whichever limit is reached first. |
| **v272** | The code comes off the total. A new SQL script (`promo_track.sql`) publishes `promo_code` and `promo_rm` on the order, and the three WhatsApp messages print `Promo FRESH10: -RM10.00` between the workings and `To pay`. |
| **v273** | Message style (More → Settings): one switch for all four customer messages — **Plain** (the default) or **the greeting leans over** (italics only, since WhatsApp carries no fonts). |
| **v274** | The shop's own sentence in the chalk hand (ShantellSans), on the amber strip's second line only. Latin-only face, so an English or BM sentence wears it and a Chinese one keeps its plain lettering. |
| **v275** | A discount nobody earned: the smallest basket is now asked wherever the money is worked out, so an order that never reached it gets nothing off. |
| **v276** | An order's money reads as a receipt on her own two screens (the Edit pop-up and the Note / tracking card), and a code that gave nothing is a named RM 0.00 line rather than silence. |
| **v277** | The money lines up in one column — **on jerky's Orders list only**. See the deliberate divergence below. |
| **v278** | A code's life: Pause and End, a printed code is fixed (the end date may only move later, the ceiling only up), and the eleven steps fold into one line. |
| **v279** | The printed card: **Print it** on a public code, refusing one with no cost ceiling and saying why. Four cards on one A4 sheet, each pointing at the shop with the code filled in, and carrying no date, no count and no ceiling figure. |
| **v280** | The whole statement opens: tap **Sales** or **Cost of sales** on More → Profit and read the order lines behind the figure, from one shared `tradingRows()` so the two journals can never disagree. Gross profit and Net profit stay figures, not doors. |

### Deliberate divergences kept

- **The customer's track card keeps its single money line.** The bakery's v277 lines the track
  card's money into a right-hand column, working out an items subtotal as *published total less the
  courier's charge*. That is true on the bakery, where a charge is the only thing between the two.
  This shop also adds a **flat nationwide postage that is deliberately never published**, so the
  card would subtract nothing and print an items total RM8 too high — a figure the customer's own
  WhatsApp message contradicts. The card therefore keeps its one line, *"what they ordered — the
  total"*, which cannot be wrong because it names no subtotal at all.
- **The promo line on that card IS drawn (v272).** The discount is published on the order itself as
  `promo_rm`, so naming it needs no working out and cannot be wrong. The line sits above the total,
  exactly as the courier charge does, so a total that has already come down explains itself. Both
  `promo_code` and `promo_rm` are named in the track lookup's PostgREST `select` — PostgREST returns
  only the columns listed, so a column left out of that list is silently absent from the card.
- **The courier charge is not nudged.** The courier stays a ported, tested, switched-off secondary
  choice; nothing about her orders, money or labels changes until she sets one up.

### Localization kept

Nothing in this range needed a user-visible string reworded beyond the shop's own `pinHint` (v266),
which arrived already written for this shop in all three languages. Every bakery fixture
(`Focaccia`, `ing_flour`, `u_loaf`, `pc_*`) and bakery-voice comment stays, on purpose — see
CLAUDE.md, *Test files keep the bakery's fixtures*. No bakery identity leaked into a shipped file:
no `jienluv2bake`, no `hzpyblqygnntixkijeem`, no `Bakester`. Storage keys beginning `bakeadmin.`
are deliberately unchanged — they are origin-scoped.

## Six versions in one pass: the card holds still, and the app says when it is out of date (v254–v259)

Six engine versions, from bakery `a65c462` (v253 — exactly where jerky sat) → `b1a53eb` (v259).
**`admin/`-only, no SQL, no Edge Function, no new secret, no `store/` file.** A push is the whole
of it. Diffstat `2006 insertions, 70 deletions` across 28 files — ten under `admin/` (one new,
`admin/js/freshness.js`), sixteen test files, `CHANGELOG.md` and the tracked `changelog.pdf`.

Ported with the same **one merge per file** method as the v234–v246 and v247–v253 passes, and for
the same reason: the two apps were six apart, so it is a single cumulative three-way merge, not six
sequential ones —
`git merge-file -p --diff3 <jerky-file> <bakery@a65c462:file> <bakery@b1a53eb:file>`. Sound because
jerky's files are bakery@v253 plus localization deltas, so the bakery's v253 blob is a true common
ancestor. **All nine edited source merges and all sixteen test merges landed clean** (zero
conflicts), then each was audited by the matched-divergence rule: for every file, `diff merged-vs-jerky-original`
and `diff merged-vs-bakery-head` — when the head difference count equals jerky's base difference
count, the merge added the bakery's changes, kept jerky's divergences and leaked no bakery identity.

`admin/js/version.js` is now `259`.

### The ten files

| File | How |
|---|---|
| `admin/js/freshness.js` | **New.** `parseVersion`, `deployedBuild({ fetchImpl, base })` (probes `js/version.js?...&probe=<now>` with `cache: "no-store"`), `decide({ running, deployed, tried })` and `startFreshnessWatch`. Copied verbatim — nothing in it is bakery-specific. |
| `admin/js/version.js` | `ENGINE_VERSION` `"253"` → `"259"`. |
| `admin/sw.js` | Fetches the app's own code with `{ cache: "no-cache" }` (`CODE = /\.(?:js\|css\|html)$/i`, `isCode`, `askNetwork` with a synchronous-throw fallback so a browser refusing the init keeps its offline cache). Images and the manifest untouched. |
| `admin/index.html` | `<div id="update-bar" class="update-bar" hidden></div>` above `#confirm-layer`. |
| `admin/js/app.js` | Imports `ENGINE_VERSION` and `startFreshnessWatch`; calls `startFreshnessWatch({ running: ENGINE_VERSION })` before the lock/sign-in gates. |
| `admin/js/ui.js` | Gains `scrollerFor(node)` and `keepStill(anchor, fn)` — the shared anchor-and-delta rule, moved out of `courier_quote.js`. `scrollerFor` walks parents by hand rather than with `closest()`, because a selector the browser answers but a Node shim does not is a rule the tests cannot see. |
| `admin/js/place_map.js` | Module-level `livePins` Set plus `reapPins()`, swept one microtask after each mount (the deferral is load-bearing: the rebuild evaluates the new block as an argument to `replaceChildren`, so at mount time the old box is still connected). The match list becomes a floating `.sugg-drop` inside `.btn-row.sugg-host`. |
| `admin/js/views/courier_quote.js` | `paintDoor()`/`paintDoorNow()` split around `keepStill(doorBtns, …)`; the map-fail path wrapped too; the button relabelled. |
| `admin/js/views/orders.js` | The outside-tap listener returns early on a press inside a visible `popup-layer`/`confirm-layer`/`lock-layer`; the `+ Place Order` relabels; and the v259 fix — `const save` → `const saveEdits` in `popupEditBody`, because a function-scoped `save` shadowed the `save` imported from `state.js` for the whole body. |
| `admin/css/app.css` | `.update-bar`/`.update-bar-inner`/`.update-bar-msg`, `.btn-row.sugg-host { position: relative; }` + the `.sugg-drop` panel, and `position: relative; z-index: 0;` on `.place-map` (Leaflet sets only `position:relative; z-index:auto`, which creates no stacking context, so its layers up to 1000 competed with the fixed layers at 20–80). |

### The six versions

| Version | What it bought |
|---|---|
| **v254** | The `+ New order` card holds still through a pin reset (the button row is the anchor, so the words extend downwards); orphaned Leaflet maps are swept by `reapPins()`; and the finishing button is renamed `+ Place Order` (the card's title stays `+ New order`, and Edit still ends on Save changes). |
| **v255** | The pin picker's own "Look it up" no longer throws the card about — the anchor-and-delta rule moves into `ui.js` as `keepStill`/`scrollerFor` and the picker's four paint sites anchor on the map box. |
| **v256** | The match list floats under the button, so it takes no space at all and shoves nothing down; picking a row closes it. |
| **v257** | A press on the card's own confirmation no longer folds the card — a press inside a visible overlay layer returns before the fold. |
| **v258** | The app tells the owner when the phone is running an old build: `sw.js` revalidates its own code, and `freshness.js` shows an amber strip with **Update now** when the running and deployed versions differ; after a failed reload it stops offering the button rather than being a dead control. |
| **v259** | An order's Edit card stops closing when "Look this address up again" is pressed — the local `save` shadowed the store import. |

### Localization kept

Only two test fixtures held the bakery's brand in a user-visible position and were localized:
`test/courier-quote-card.test.js` and `test/edit-popup-relook.test.js` both carry a
`storefront: { name: … }`, changed to `Munchies Furkidz`. Every other bakery fixture
(`Focaccia`, `ing_flour`, `u_loaf`, `pc_*`) and bakery-voice comment stays, on purpose — see
CLAUDE.md, *Test files keep the bakery's fixtures*.

No bakery identity leaked: no `jienluv2bake`, no `hzpyblqygnntixkijeem`, no `Bakester` in any
shipped file. Session/storage keys beginning `bakeadmin.` are deliberately unchanged — they are
origin-scoped — including `freshness.js`'s own `TRIED_KEY = "bakeadmin.updateTried"`.

## Seven versions in one pass: the shop's feedback box (v247–v253)

Seven engine versions, from bakery `5ba41df` (v246 — exactly where jerky sat) → `a65c462` (v253).
**No SQL, no migration, no new secret.** Every version is one feature — a way for a customer to tell
the developer what they would change about the shop page, in their own words — and it lives entirely
on the shop front. It adds **three files**, one of them an Edge Function that leaves the repo and has
to be deployed by hand (see *The owner's one step* below).

The port used the same method as the v234–v246 pass, and for the same reason — the two apps are
seven apart, so it is **one merge per file**, not seven sequential ones:
`git merge-file -p --diff3 <jerky-file> <bakery@5ba41df:file> <bakery@a65c462:file>`. Sound because
jerky's files are bakery@v246 plus localization deltas, so the bakery's v246 blob is a true common
ancestor. Diffstat `1898 insertions, 31 deletions` across 11 files: seven merged clean (including
`store/app.js`, `store/app.css`, `store/index.html`), `store-lang.js` with **eleven conflicts**, and
three files that are new to jerky.

`admin/js/version.js` is now `253`.

### The eleven files

| File | How |
|---|---|
| `admin/js/version.js` | merged — the number |
| `store/app.js` | merged clean; three comments localized (`the baker` → `the owner`) |
| `store/app.css` | merged clean — the foot's box |
| `store/index.html` | merged clean — one line, `#fb-foot` |
| `store-lang.js` | **hand-merge, eleven conflicts** |
| `test/store-i18n.test.js` | merged clean — the six `fb*` keys per language |
| `store/feedback.js` | **new** — the shop's network half |
| `supabase/functions/shop-feedback/index.ts` | **new** — the mail builder |
| `test/store-feedback.test.js` | **new** — ~40 tests |
| `CHANGELOG.md` | jerky writes its own |
| `changelog.pdf` | rebuilt by `marketing/build_changelog.py` |

### What each version brought

| | |
|---|---|
| **v247** | The box at the foot of the shop: one autogrowing line printed with her own question, no Send button (**Enter sends**), the reply swapped in the moment a send lands, and the words arriving as an ordinary email at the published developer address — read server-side, never from the caller. No box at all until that address is set. |
| **v248** | Leaving the page is itself a send (`pagehide` + `fetch keepalive`, once, skipped offline), the half-typed sentence is kept as a draft on the customer's own device and put back, a failed send keeps the words in the box; and the shop's **Bahasa Malaysia rewritten** to how Malaysians actually write, with the Chinese moved to **Malaysian** Chinese (mainland measure word, "shopping bag", and traditional arrows fixed). |
| **v249** | The line introduces itself — "Webmaster: Like this UI? Tell me, I'll make it better" — and the box opens itself when the question wraps, so its tail is never clipped. |
| **v250** | "UI" spelled out: "Webmaster: Like the user interface? I'll improve it". A measurement, not a rewrite — the spelled-out term costs about half the box's 323px on a phone. |
| **v251** | Her own sentence, verbatim: "Webmaster: Like the User Interface? Tell me & I will improve it!". Two lines on a phone, and the autogrow shows all of it. |
| **v252** | Every mail now carries the same heading block the wish-list mail has — **Project** (the live address, read off the page), **Sent** (her own clock, Penang), **Engine** (in the subject too), **Written in** — and the shop page's foot prints `Engine v<n>`, read from `admin/js/version.js` so the two can never drift. |
| **v253** | The heading block moves to the top and the customer's words come last, matching the wish-list mail's order; and the language is written out — "Written in English.", not "en". |

### The eleven conflicts, and what jerky kept

All eleven are in `store-lang.js` — the hand-merge surface, and the only file in this sync where the
two shops' wording can collide. Every one resolved the same way: **keep jerky's side** (its own nouns
and its extra keys) **and lay the bakery's v248 voice fixes onto it**.

| Conflict | Resolution |
|---|---|
| `zh` referral | the bakery's campaign wording; jerky's own `code*` keys and `deliveryDays: "发货日"` kept |
| `zh` `waSub` | the bakery's new sentence, formal **您** kept |
| `zh` `calPrev` / `calNext` | the bakery's simplified 前一周 / 下一周 |
| `zh` `orderCancelNote` (+`One`) | the bakery's reword, jerky's **发货日** noun kept |
| `zh` `failBody` | the bakery's reword |
| `zh` `courierCod` | 快递员 → **送货员** (the delivery person, not the bakery's courier); jerky's `postageQuoted` kept |
| `ms` `confirmClosedBody` | jerky's **hari pos**, the bakery's "yang lain" |
| `ms` `confirmChangedBody` | jerky's **snek**, the bakery's "sudah … ikut" |
| `ms` `sendingToBakery` | the bakery's "Sedang"; jerky still drops "kepada pembuat kek" |
| `ms` `orderRecvSub` | jerky's own "telah diterima" → the bakery's **sudah** |
| `ms` `trkFinal` | jerky's **"Sudah diambil / Sudah dipos"** — "dipos", never the bakery's "dihantar" |

### The three new files, and what the audit found

- **`store/feedback.js`** (154 lines) — copied, then localized in two comments (the recipient is read
  from "the **shop's** own published settings"; the envelope is signed by "this **shop's** verified
  domain"). The file's whole security design is that it has **no `to` field**: the address is read
  server-side from the published `storefront_config` row, so a public form can never mail an address a
  caller named.
- **`supabase/functions/shop-feedback/index.ts`** (204 lines) — one real identity leak was found and
  fixed: the `from` fallback was `BakeAdmin wishes <wishlist@send.jienluv2bake.com.my>`, now
  `Munchies Furkidz wishes <wishlist@send.munchies.com.my>`. The rest is comments ("baker" → "owner").
  The honeypot is answered as a **success** on purpose; the engine number is dipped to digits and dots
  before it reaches the subject; the body is sent as text.
- **`test/store-feedback.test.js`** (914 lines) — copied **verbatim**. Under the fixture policy the
  bakery names in a test (`jienluv2bake.com.my` as a fixture origin, bakery-voice comments) are
  deliberate; only user-visible strings and assertions get localized, and the two it asserts on
  (`STORE.en.fbPh`, `STORE.en.fbThanks`) are jerky's own values.

### A false alarm worth knowing about

A union check over the merged `store-lang.js` reports three keys missing — `trkItems`, `itemsTotal`,
`trkTotal`. They are in the bakery and **deliberately absent here**: jerky's track card does not use
the bakery's v199 money block, because the shop adds a flat postage that is never published, so the
subtotal would come out RM8 too high (the reasoning is written at `store/app.js:2218`). The keys are
supposed to be missing, and the check is right to say so.

### The owner's one step — DONE 2026-09-30

The mail builder lives on Supabase, not on GitHub, so a push does not update it — and **v253 changes
it**, which made the deploy unavoidable. **It is deployed**: `shop-feedback`, ACTIVE, **VERSION 1**,
`2026-09-30 10:21:46 UTC` (`supabase functions list --project-ref ircwozniiyywsowamixy`).

```
supabase functions deploy shop-feedback --project-ref ircwozniiyywsowamixy
```

**Run it from the repo folder** — never from inside `supabase/functions/shop-feedback/`. With no
`supabase/config.toml`, the CLI anchors on the current folder: from inside the function it looks for
`supabase/functions/shop-feedback/supabase/functions/shop-feedback/index.ts` and dies with *"Entrypoint
path does not exist"* (the first attempt, 2026-09-30). The "own folder" rule is a different thing —
**a helper must live inside the function's own folder to be uploaded** at all. Nothing else: no SQL,
no new secret, no new table. It reuses the `RESEND_API_KEY` and verified sending domain the wish list
already runs on, and the developer address already published in **Settings → Website & developer**.
If the function is ever changed again, redeploy the same way; until then the box still appears and
still says the send did not go through.

## Thirteen versions in one pass: the item note, the pin reset, the run guard, the labels (v234–v246)

Thirteen engine versions, from bakery `93a87b2` (v233 — exactly where jerky sat) → `5ba41df` (v246).
**Code-only: no SQL, no migration, no secret, no deploy.** Everything the versions add is in the app's
own files, and every column they read was already applied — `supabase/courier_job.sql` and
`supabase/postage_mode.sql` were pasted and confirmed on 2026-09-28.

**This is the first cumulative port.** Earlier syncs walked the bakery's log one version at a time. Here
the two apps were thirteen apart, so the port was done as **one merge per file** rather than thirteen
sequential ones: `git merge-file -p --diff3 <jerky-file> <bakery@93a87b2:file> <bakery@5ba41df:file>`.
That is sound because jerky's `admin/` files are bakery@v233 plus localization deltas, so the bakery's
v233 blob is a true common ancestor. It produced **8 conflicts across 38 files** — six in
`admin/js/views/orders.js`, two in tests — against a combined `6160 insertions, 434 deletions` diffstat.

`admin/js/version.js` is now `246`.

### The seventeen source files

`admin/css/app.css` · `admin/js/calendar.js` · `admin/js/courier.js` · `admin/js/courier_job.js` ·
`admin/js/courier_place.js` · `admin/js/couriers/lalamove.js` · `admin/js/place_map.js` ·
`admin/js/supabase.js` · `admin/js/views/courier_quote.js` · `admin/js/views/delivery_run.js` ·
`admin/js/views/orders.js` · `admin/js/views/products.js` · `store-lang.js` · `store/app.css` ·
`store/app.js` · `store/index.html` · `storefront-fields.js`.

`store/app.js` and the root `store-lang.js` were **hand-merges, not copies** — they stopped being the
bakery's at v231 — and `store/index.html` / `storefront-fields.js` carry the v237 note wording.

### What each version brought

| | |
|---|---|
| **v234** | A booked trip names when calling it off stops being free (the courier's 45-minute rule), and the sentence turns over by itself when the window shuts. An immediate booking states the rule instead of inventing a pickup time. |
| **v235** | The booked-trip card sums what the trip cost against what you charged and says which way the difference fell. A trip with no charge recorded says the whole cost is yours; a matching charge draws no line at all. |
| **v236** | A note on each item, switched on per product. The tick is a storefront field carried to the shop by `mergeStorefront()` alongside the rest of the product details, and a note rides with the order phone-to-phone. |
| **v237** | A posted order in one pass — the charge, tracking number, parcel carrier and price block moved onto the ＋ New order card — and the card's day is one line with the calendar folding out under it. |
| **v238** | Reset the pin from the address, with the customer's own pin protected behind a confirmation and restorable in one press; and the map zooms without Move this pin. |
| **v239** | The reset is offered wherever a pin exists to replace, not only when the pin is the customer's own. |
| **v240** | The reset press is wired the moment the card opens, instead of waiting on the delivery-price half being built. |
| **v241** | The reset's answer is said on the line you can see — the door card while the price section is folded away. |
| **v242** | The delivery run opens an already-booked customer off the run, counts them in its head, and offers Call off the trip and add to this run. |
| **v243** | The order screens' day calendar is five weeks anchored on today, matching the shop's, with the arrows moving one week and left off where there is nowhere to go. |
| **v244** | An item's own note is underlined on the Orders list and both printed sheets. |
| **v245** | The delivery note is underlined too, and prints on the Compact label where it used to be dropped. |
| **v246** | Each noted item's words are underlined on the Compact label's joined line, on the item they belong to. |

### The six conflicts, and what jerky kept

All six are in `admin/js/views/orders.js`, and every one resolved the same way — **take the bakery's
head, then re-apply jerky's wording**:

- **The draft, hoisted to module scope.** `newOrderContact` became `newOrderDraft` (+ `newFormDayOpen`,
  `newFormDayView`). This is the v237/v238 change that lets the card keep what you typed across the
  rebuild a day tap causes; `addNew` now clears it by hand on a successful add.
- **`sheetItemRow` / `sheetNoteRow`** replace the inline label loops on the mail-line, full and
  compact sheets — jerky kept its own `Post` / `Post to:` wording on the address row.
- **`paintCourier()`** is now the callback the Fulfilment select fires, so switching back to a posted
  order **rebuilds** the block rather than re-showing a dead one. jerky's labels stay
  `Collect (local)` / `Post (nationwide)`.

### The five new test files, and the two the merge had to localize

New, copied from the bakery head: `test/courier-quote-card.test.js`,
`test/line-note-underline.test.js`, `test/order-line-note.test.js`,
`test/orders-card-courier.test.js`, `test/place-map.test.js`. Twenty-one existing suites were merged
(only `test/store.test.js` and `test/storefront.config.test.js` conflicted — both resolved as a union).

**Two bakery idioms in the merged suites do not exist in jerky's copies**, and both are the ordinary
localization rule rather than a defect:

- `test/no-null-text.test.js` uses `strays()` where the bakery renamed it `strayNulls()`, and jerky's
  `state()` inlines its own two products instead of taking a `products` list, so the bakery's
  `FOCACCIA` constant has no jerky counterpart. The two v237/v238 tests use jerky's own spellings now.
- `test/orders-card-courier.test.js` selected the Fulfilment option by the bakery's label
  (`"Courier delivery"` / `"Self collect"`) and the address box by the bakery's placeholder
  (`"Delivery address (if courier)"`). jerky says **Post (nationwide)** / **Collect (local)** and its
  address box is placeheld **Postal address (for posting)** — the same swap
  `test/customer-suggest.test.js` and `test/order-address-suggest.test.js` already carry a comment
  about.

Bakery fixtures (`Focaccia`, `Sourdough`, `Jienluv2bake` in a stubbed storefront) are deliberately left
in place, per the documented fixture policy.

`node --test test/*.test.js` → **2388 pass, 0 fail**.

### Jerky-only work that had to survive

Re-checked by grep after the merge, all intact: the 🐾 empty-photo placeholder
(`views/products.js`), the three `null`-child guards (`views/orders.js` `.filter(Boolean)`,
`views/settings.js` `...(sampleCard ? [sampleCard] : [])`, `datepicker.js` `todayShortcut`), the
jerky-only `/guide` route (`app.js`, `views/more.js`), `moneyLines()` in `courier.js`, the
courier-provider seam (no engine file outside the registry and the provider names the courier), the
track lookup's named `select` list in `store/app.js`, and the 21 Sep shop-calendar deltas.


## The order page has a way back to your homepage (v233)

One engine version, from bakery `15b1043` → `93a87b2`. **Code-only — no SQL.** It is one small
addition on the shop page, and a **hand-merge** here rather than a copy, because jerky's `store/`
and the root `store-lang.js` are no longer the bakery's.

A customer reaches `/store/` from an Instagram bio, a shared link or a bookmark as often as from the
homepage, and the order page had **no route back to `/` at all** — so a visitor who landed there
first could not reach the reviews, the gallery or the story. `store/index.html` now carries, on its
own line under the tagline inside `header.hero`:

```html
<a id="home-link" class="hero-home" href="/" data-i18n="homeLink">🏠 Our homepage</a>
```

It is the ordinary `data-i18n` path, so the shop's existing EN / 中文 / BM switch translates it **in
place** like every other tagged string. `homeLink` is a new key in all three dictionaries
(`🏠 Our homepage` / `🏠 我们的主页` / `🏠 Laman utama kami`) — copied from the bakery verbatim, since
the wording is not brand-specific.

**Why its own line, not a third item on the top row.** The top row is the eyebrow beside the
language pills, and at 375px the eyebrow already wraps to two lines; a third item would have pushed
the language switch out of reach. `.hero-home` in `store/app.css` gives the link the same pill shape
as those pills (`border-radius: 999px`) and a full `min-height: 36px`, so it is a real tap target
rather than a line of text.

`test/store-i18n.test.js` gains one test: the tag exists, its `href` is `/`, the root `index.html`
really is served there (`<html` present — a link to a path with nothing behind it is a 404 in a nav
item's clothes), the label is keyed, and both the Chinese and BM strings differ from English.

Nothing about taking an order changed.

## A translated line you empty goes quiet (v232)

One engine version, from bakery `9bbe406` → `15b1043`. **Code-only — no SQL.** Both halves are on
the 中文 / Bahasa Malaysia card in a product's Edit screen (`admin/js/views/products.js`).

### The greyed words and the → are one offer, written in one place

The card offers a machine translation as a **greyed hint** with a right-pointing `→` drawn over it
(the app's shared `data-suggest` gesture). Those two things were written in **two** places —
`loadSuggestion()` set `node.dataset.suggest` and `node.placeholder` — so they could disagree.
The failure the owner reported: emptying a translated line on purpose left the translation back in
the box, greyed, with the arrow gone, because the placeholder survived and the dataset did not.
**`refreshRow()` is now the single writer of both**, deriving them from the same `offer`, so a line
can never show words that nothing will take:

```js
const hers = manualSet.has(variant);           // typed into, or deliberately emptied
const offer = empty && !hers ? suggests[variant] : "";
if (offer) node.dataset.suggest = offer;
else delete node.dataset.suggest;
if (empty && hers && englishSource(variant)) node.placeholder = BLANK_HINT;
```

`loadSuggestion()` also gained one early return — `if (manualSet.has(variant))` — placed **after**
the "Needs the English above first" branch and **before** the network call, so a line she made hers
is neither offered words back nor asked for a translation. `BLANK_HINT` is
`"Left blank — English shows."`: 229px of room in the Edit pop-up at 375px, measured, not guessed.

### The hint's tail was cut off mid-word

`hintFor()` built `e.g. ${t}……if blank, it will be filled with English`. On a one-line box that
tail ran past the right edge and was clipped **right where the `→` sits** — the sentence explaining
the line was the one you could not read. It is now `e.g. ${t}`, the same shape as every other
suggested field in the app; the promise is still made in full in the card's own paragraph above,
which was reworded to say that a typed line is yours and that an emptied line also shows `↻`.

**Merge note:** `admin/js/version.js` was byte-identical to the bakery base and was copied
wholesale. `admin/js/views/products.js` and `test/products-editor.test.js` are **fork points** —
both hand-merged with `git merge-file -p --diff3`, **0 conflicts each**, and audited: the diff
against jerky's own copy is exactly the four v232 hunks and nothing else. All nine jerky
product-editor strings survive ("Feeding tip", "e.g. Chicken Jerky", the pouch/batch/posting-day
limit wording, the two card-sub descriptions, "which cut or brand of meat", the serving-tip
placeholder) along with the 🐾 empty-photo placeholder and zero 🍞. The test file keeps its bakery
fixtures (`Focaccia`, `u_loaf`, `ing_flour`) per the documented fixture policy; `formHandles()`
still finds the name box by jerky's own `e.g. Chicken Jerky` placeholder.

## The address box, and the shop's picker in whole weeks (v229–v231)

Three engine versions in one pass, from bakery `8affbb1` → `9bbe406`. **Code-only — no SQL.**
Two versions fix the same thing on the backoffice side (an address does not fit on one line, and
the box gave it no room), and the third is the shop's own calendar.

### v229 — the delivery address box is a `textarea`

A real address is four or five lines on a phone; a one-line `input` hid most of it and scrolled
sideways. The box became `el("textarea", { class: "input", rows: 4, ... })` at **three** sites:
`admin/js/views/orders.js` twice (the ＋ New order card and an order's Edit pop-up) and
`admin/js/place_map.js` once (`rows: 3`, on the pin card under *Put this doorstep on the map*).
**No CSS change was needed** — `admin/css/app.css` already carried
`textarea.input { min-height: 64px; resize: vertical; }`, so the taller box and the drag-to-resize
handle came with the tag change. Two test helpers that find the box by **tag name** moved
`INPUT` → `TEXTAREA`, and gained `rows >= 3` / `spansBoth` assertions.

### v230 — and it spans both columns

The order form is a two-column grid (`.form-grid { display: grid; grid-template-columns: 1fr 1fr; }`),
so the address sat in one column with an empty cell beside it. Its wrapper gained
`el("div", { class: "span2" }, ...)` — the rule `.form-grid .span2 { grid-column: 1 / -1; }` already
existed at `admin/css/app.css:621` and had been used nowhere until now. Measured 137px → 315px at
375px. The pin card is deliberately untouched (it lays out differently), and the shop's own
customer address box stays a one-line `input` — a different box on a different screen.

### v231 — the shop's posting-day picker is five whole weeks (SHOP ONLY)

`store/app.js`'s calendar stopped being a month page and became **five whole weeks that follow
today**. The leading and trailing squares of a month were padded with dead numbers; now **every
cell is a real date**.

New pure helpers in `store/calendar.js`:

- `WINDOW_WEEKS = 5`, `rollingWeeks(todayISO, { offset = 0, rows = WINDOW_WEEKS } = {})` — `offset`
  whole weeks forward from today's own window, first row = the week just gone, no nulls anywhere.
- `weekIndex(todayISO, dateISO)` — 0 = this week, −1 = last week, +1 = next week. The unit the
  arrows move in.
- `windowBounds(todayISO, firstISO, lastISO)` → `{ home, last }`, where
  `home = Math.max(0, weekIndex(today, first) - 1)` (today's own window, sliding forward only when
  nothing on sale is inside it) and `last = Math.max(home, weekIndex(today, last) - (WINDOW_WEEKS - 2))`
  — the promise that **no published date can be paged out of reach**.

`monthWeeks(year, month)` and `addMonth(year, month, delta)` are **retained** in the file (the
bakery keeps them too) but are no longer used by the shop.

Shop mechanics: `monthTitle` → exported `windowTitle(fromIso, toIso)`; `calMonth` → `calOffset`;
new `calSlide`. The arrows are **omitted rather than greyed** (`.cal-nav:disabled` deleted as dead
code) with an empty `.cal-slot` span holding the title's 36px grid track, because `el()` skips null
children and the title would otherwise drift sideways when an arrow came or went. The arrival
animation rides as **`data-slide` on `.cal-grid`** — not a class, because three DOM tests select the
grid by exact `className` — set only by an arrow tap and cleared by the very next paint
(`@keyframes cal-week-up` / `cal-week-down 180ms ease-out`, suppressed under
`prefers-reduced-motion: reduce`). `soldOutLine(specs, month)` → `soldOutLine(specs, shown)` where
`shown = new Set(weeks.flat())`, and the `.cal-cell.blank` rule was deleted.

**This collided with jerky's own 21 Sep shop-calendar work**, which rewrote the same closure: the
tap-answer (`missIso`, `missClosed`, `dayAsk`, `postsOn`, `missNote`, the `askable`/`closed` cell
logic, `.cal-miss`, and the `calMiss`/`calClose` strings) all survive intact, and `dayAsk` still
decides *miss* / *closed* / silence exactly as before. Only the window it is drawn in changed.

### Worth knowing

- The bakery's v231 commit also added `img/focaccia 800g.jpeg` — a bakery-only asset, deliberately
  **not** ported (jerky has no `img/` directory).
- The bakery's own Simplified-Chinese file uses the Traditional `週` in `前一週` / `下一週`; jerky now
  matches it verbatim, so the zh `calPrev`/`calNext` carry a Traditional character beside Simplified
  neighbours. Cosmetic, flagged rather than churned.
- **Pre-existing mixed wording, still mixed:** the field's *label* reads "Delivery address (if
  courier)" while its *placeholder* reads "Postal address (for posting)". Both predate this pass,
  neither is pinned by a test, and they were left alone again.

## Parcels, and an address that fills itself in (v226–v228)

Three engine versions in one pass, one theme: how a posted order finds a door. **Code-only — no
SQL.** The bakery's own commits are `44f7276` (v226), `e8bd78e` (v227) and `7a1dd26` (v228), plus
the rename follow-up `8affbb1`, which is the state ported here.

### v226 — a parcel carrier is a RECORD, not an integration

The third way an order leaves the house, beside the flat postage and the bookable courier: the box
she takes to a counter or books on the carrier's own website herself. New pure module
`admin/js/parcel.js` (`parcelOf`, `carrierOf`, `parcelHanded`, `setParcel`, `markHanded`,
`clearParcel`, `notParcelable`, `USUAL_CARRIERS`, `missingCarriers`) plus the new screen
`admin/js/views/parcelCouriers.js` at `#/parcel-couriers` (More → **📦 Parcel couriers**).

Deliberately **not** in `admin/js/couriers.js`, whose registry is the seam for a courier the app
*asks*: to be one at all a provider must answer vehicles, quote and book, and a parcel carrier
answers none of those here. So a parcel is a record on the order — `order.parcel =
{carrierId, carrierName, handedAt}` — synced whole like every other order field, with no column
and no migration. `carrierName` is **frozen at record time**, exactly as a booked trip freezes its
courier's own name, so renaming or deleting a carrier later never rewrites what a customer was
already told at what her books already say. A record with no carrier reads as no record.

The consignment number rides the order's **existing** `trackingNo` slot — a parcel's number is the
"read it out" kind, which the shipped message, the customer's card and the pop-up's tracking box
already render from that one value. Keeping one slot is what stops those three ever disagreeing. A
**parcel and a booked trip are mutually exclusive** on one order, and `admin/js/supabase.js`'s
`trackingSnapshot` gives the trip priority: `courier_phase` is the trip's phase when there is one,
else `"collected"` for a handed-over parcel.

The per-product tick **"Can travel as a parcel"** (`product.parcel === true`) **gates nothing** —
it is written only when ON, so a product she never opens is byte-for-byte unchanged and unticking
leaves no `parcel: false` behind. It exists to make one sentence possible: the advisory
`notParcelable(state, group)` returns the line names that are not marked parcelable, and the order
screen *names* them while leaving every control exactly where it is.

**Two latent faults repaired**, both long dead and both invisible:

- **`admin/js/ui.js` — the app's own `select()` change handler had been dead for ~100 versions.**
  It was the listener itself, so browsers called it with the element as `this`, and several callers
  read the new value as `this.value`. v121 wrapped it in an arrow to repaint the tone, and an arrow
  cannot carry a `this` — so every one of those handlers had been throwing on its first line since.
  The picker still changed on screen, so nothing looked broken; the code after the throw simply
  never ran. Nothing depended on it until the carrier picker did.
- **The Note / tracking card rebuilt its draft on every repaint.** `openNoteTrackingPopup`'s
  `draft` is now hoisted out of the body, because the parcel's carrier picker asks for a repaint
  when it changes and the body is rebuilt from scratch each time — held inside, a repaint threw
  away the carrier she had just named and the number she had just typed, and the hand-over press
  never appeared.

### v227 — the address fills in from her own order history

`admin/js/customers.js`'s `suggestedAddress(state, {customerName, whatsapp, ...})` reads the
address off the most recent order for that person. It helps a **returning** customer only, since
it reads her own past orders, and it never overwrites an address already typed into the box.

### v228 — Google as-you-type suggestions, for the new customer

A new pure module `supabase/functions/courier/suggest.ts` (`suggestAddresses`, `allowSuggestion`,
`HitRecord`) and a new `action === "autocomplete"` branch in the **session-gated** `courier`
function, sitting **above** `configFor(provider)` — so it answers with no courier key in sight,
for the same reason `geocode` does. The branch carries a **per-user 60-per-60-seconds limiter**
keyed on her own user id, not her IP: she chose to have **no daily cap** on Places, so this map is
the thing that stops a runaway. A refused caller gets `{ok: true, places: []}`, not an error — a
runaway is by definition not a person reading the screen, and the honest answer is the one a
person gets when there are no suggestions this time.

One shared `addressSuggester(state, onPick)` in `admin/js/views/orders.js` is wired into **both**
order forms, the New order card and the Edit pop-up. It waits for a pause before asking, ignores a
fragment, discards an answer that lands after she has typed on, and writes **both** the draft and
the box on a tap — the same pair the customer suggester writes. It is inert until **Places API
(New)** is enabled on the Google key the map lookup already uses; the key itself is a
**project-level** secret (`GOOGLE_GEOCODING_KEY`, set with no `--function` flag, so every function
including `courier` can read it), and `suggest.ts` reads the same name the bakery does.

**Deploy note, and it is transferable:** `supabase functions deploy` does **not** upload the
function folder — it walks the **import graph** out of `index.ts` and silently skips any file
nothing imports, which reads exactly like the CLI dropping a file. After v228 the courier upload is
**seven assets**: `index.ts`, `booking.ts`, `place.ts`, `suggest.ts`, `geocode.ts`,
`providers/lalamove.ts`, `sign.mjs`. **Deploy from the app's own folder.**

### Test-file localization, and the one string left alone

The two new suites find the address box by its **placeholder**, which this app words
`"Postal address (for posting)"` where the bakery says `"Delivery address (if courier)"` — so that
one constant differs in `test/order-address-suggest.test.js` and `test/customer-suggest.test.js`.
Bakery fixtures (`Focaccia`, `pc`, `ing_flour`) are left as-is per the documented fixture policy.
**Left alone deliberately:** the address field's *label* in `admin/js/views/orders.js` still reads
`"Delivery address (if courier)"` — a pre-existing bakery wording, untouched by this pass and
pinned by no test. Flagged rather than churned; it is a one-word change if she wants it.

## A product on the shop can always be hidden (v225)

One button, one place. Code-only — no SQL.

The live-products branch of `productCard()` in `admin/js/views/products.js` used to pick a
**single** action from the product's `protect` flag: `button(protect ? "Hide" : "Delete", …)`.
`protect` is true when the product is used by an order or a set, so a freshly published product —
no orders yet — fell to the `Delete` side and offered Delete **and nothing else**. Delete takes
the recipe with it, so the one product most likely to want a quiet spell off the shop was the one
that could only be destroyed.

Now Hide is unconditional and Delete joins it only when it is safe:

```js
actions.push(button("Hide", () => setProductState(state, p, "hidden", root), "ghost small"));
if (!protect) actions.push(button("Delete", () => deleteProduct(state, p, usedBy, usedInSets, root), "ghost small"));
```

`setProductState(state, p, "hidden", root)` is the same call the Hidden list's row uses for
Unhide, so Hide keeps the recipe, the photo, the price, the category and the history, and Unhide
brings it straight back. `deleteProduct` is unchanged — the "Hide" confirm that used to sit in its
protect branch once routed Hide **through** it; nothing routes that way any more, so that branch
is now unreachable from the live row and is kept verbatim rather than trimmed. A product with
orders therefore reads **Edit · Hide**, a clean live one reads **Edit · Hide · Delete**.
`test/products-editor.test.js` locks both: a rewritten case asserts the fresh product offers both
buttons, that Hide leaves `p.recipe` deep-equal and the product still present under
`Hidden — taken down (1)`, and that Delete on a clean product still really deletes; the
with-orders case now asserts `!buttonByText(root, "Delete")`.

## The picture window is square, and the product row is a shop view (v224)

Two changes in one engine version, both about a product. Code-only — no SQL.

**The square, and the crop.** `readPhoto(file, cb, w = 200, h = w, budget = 30000)` in
`admin/js/photo.js` is now the only reader — `readPhotoFit` is gone. The source rectangle is
computed once as **the middle `min(w, h)` square of the image scaled to fill**, so the crop never
moves as the box shrinks; then the loop draws, encodes at JPEG q0.72 and steps the box by `×0.8`
(up to six passes) until the data URL fits `budget` **or** the box is 64 px on its long side. The
products editor calls it as `readPhoto(f, cb, 360)`. `.thumb-box` and `.prod-thumb` in
`admin/css/app.css` and `.menu-thumb` in `store/app.css` carry `object-fit: cover`, which is what
fills the square window — including for a photo saved before v224, which keeps the rectangle it
was stored in and is trimmed to the square's middle only for display. `storefront-fields.js`
still holds `THUMB_MAX = 40000` and the `isThumb()` test; the two publish whitelists import it so
they cannot drift.

**The product row.** `productCard()` in `views/products.js` no longer prints the per-unit
ingredient cost or the recipe's own lines. `recipeLineCosts` is still imported for the Edit
screen — the row is the shop view, the cost and the recipe are the Edit view, and a comment in
the code says not to add them back. `test/products-order.test.js` pins the absence: the row must
match `/RM 16\.00 sell/` and must **not** match `/\/\s*unit/` or contain an ingredient name.

## The customer and the product list (v119–v123)

Five versions about the two things an order form asks for: *who* the order is for,
and *what* is on it. All code-only — no SQL.

- **Customer autocomplete** (v119) — `customerSuggester(state, onPick)` in
  `admin/js/views/orders.js` builds its list **once per visit** (`attachProfiles` over
  `customerList(state, "recent", "all", todayISO())`) and paints up to five hits into a
  `.sugg-panel` item of the form's own grid — in the normal flow, never a floating
  overlay, because the Edit pop-up's body scrolls and would clip one. It opens on
  **two** letters, like the shop's finders: one letter is not a search. A row reads
  `number · N orders · usually <product>` (`suggestionSub`), and a tap writes both the
  boxes and the draft (`newOrderContact`, module scope so a mid-edit re-render keeps
  what was typed). `customerNameMatches(row, query)` is deliberately narrower than the
  Customers finder: it matches the name *shown* for the person, or their number, so a
  hit whose own title does not contain the query is never offered.
- **One customer is one row** (v120) — the same person could be two rows because
  `+60123456789` and `60123456789` keyed differently. `phoneDigits(v)` / `waKey(v)`
  (`admin/js/profiles.js`) now read a number by its digits, used by both `keyOf` and
  `admin/js/customers.js`. A one-time `canonicaliseCustomers(state)` (run from `app.js`
  under `migratedV120`, idempotent — the sync layer depends on that) re-keys every saved
  record, folds the ones that collapse together (`collapseByKey` → `foldProfileInto`,
  keeping pet photos, likes and notes), and writes the canonical number onto the orders.
  `mergeCustomers(state, keepKey, absorbKey)` backs the new **Join with another customer**
  button on the customer card (`joinCustomerPopup` in `views/customers.js`) for duplicates
  the tidy cannot guess at; `touchedAt(p)` picks which record survives.
- **The product dropdown, sorted and toned** (v121) — `productOptions(state, dateId,
  excludeOrderId)` returns `{ value, label, tone, group }` for every non-draft product,
  ranked `TONE_RANK` and grouped `TONE_SECTION` (`ok` On the shop / `warn` Unavailable /
  `off` Taken down). The closed box wears the tone (`select.tone-ok/-warn/-off`), so a
  long order can be scanned without opening a list.
- **Those three kinds get headings inside the list** (v122) — `ui.js` emits real
  `<optgroup>`s, tinted by `optgroup.tone-*` / `option.tone-*` behind
  `@supports (appearance: base-select)`; older phones that will not let a page colour the
  native list still get the same three headings in the same order.
- **Unavailable, and named by the days it IS sold** (v123) — the middle section groups
  sold-out *with* not-sold-that-day, because to the owner they are one thing: an active
  product still sellable by hand. A not-sold product reads `"<name> — only <days>"`
  (`availSummary(product)` from the root `availability.js`) rather than being given a count
  for a day it was never on. The shop's own order-by deadline (`closeDays`) is deliberately
  *not* counted — it stops a stranger ordering, it says nothing about a walk-in sale.

## The books: money out, profit and loss, and your own money (v103–v118)

Eleven versions that turn the app from a takings ledger into double-entry-ish
bookkeeping: money out, the two lists the books are built from, a profit & loss
account, and a journal behind every figure — then two follow-ups (v114, v115) that
fix the Profit screen itself, and three more (v116–v118) that open the books with a
Day one balance and settle how the Paid step reads when a regular pays at pickup.
All code-only — no SQL.

- **Money out** (v103) — a saved purchase order asks what it cost. `askWhatYouPaid(state, po)`
  (`admin/js/views/history.js`, using `methodPills` from `money.js`) opens on the list's own
  total with **Cash** / **TNG** pills and a **Skip the money** that records nothing. Rows land
  in `state.expenses` (`{ id, date, category, method, note, amount, poId? }`); everything else
  goes in by hand through the new **Add an expense** form on `admin/js/views/money.js`. The
  Money screen adds up Cash in / TNG in / Cash out / TNG out / **Net**. The same version fixed
  a midnight bug: the date was being read off the UTC stamp, so a payment taken just after
  midnight counted on the day before — it is read in the owner's own zone now.
- **Money you put in** (v104) — `state.deposits` and the **Put money in** form, counted into
  Cash in / TNG in (it really is in the purse) with a line saying how much of the money in was
  the owner's own. A new `drawing`-classed category, **My own withdrawal**, is how it goes back
  out, through the same money-out list.
- **Profit & Loss** (v105) — new pure `admin/js/profit.js` (`orderDay`, `lineCost`,
  `profitBetween`, `monthSpan`; `expenseRows` arrives in v111) behind a new screen
  `admin/js/views/profit.js` (*More → 📈 Profit*, route `#/profit`). Sales are counted by
  **delivery day**; cost of sales comes from the **recipes** (`costOf`), not the packs bought;
  running costs are grouped by category; capital and drawings are reported separately and are
  in neither figure. `profitBetween` also returns `uncosted` — the lines whose recipe prices to
  nothing — so the screen can say so instead of reporting a flattering profit.
- **The two lists the books read** (v106, v108) — new pure `admin/js/accounts.js`:
  `DEFAULT_CATEGORIES` (each carrying a `cls` of `stock` / `expense` / `drawing`),
  `DEFAULT_METHODS` (`["Cash", "TNG", "Loan"]`), and readers `categoriesOf`, `methodsOf`,
  `classOfCategory`, `methodLabel`, `isCash`, `isTng`, `isOther`, `purseMethods`, `pocketMethods`,
  `drawingLabel`, `methodRank`. They live in `settings.categories` / `settings.payMethods` and
  fall back to the built-ins when untouched, so a phone that never edits them behaves exactly as
  before. They are edited **in place** by `admin/js/views/accountsEditor.js` (`entryForm`,
  `newEntryChip`) from the Money screen's *Categories & ways to pay* line — an inline form, never
  a pop-up of its own, because `showPopup()` owns a single shared layer. Renaming rewrites the
  label on the rows already recorded under it (`rewrite`); deleting deliberately leaves them, and
  they still count, printed at the end of the statement's cost list. A method that is neither cash
  nor TNG is kept **out of the net** and named on its own line, one per method.
- **A note on every transaction** (v106) — the note the Put-money-in form already had is now on
  Add an expense too, and both Money lists show it beside the amount.
- **The order item line** (v107) — the v101 price box had crushed the product dropdown to 2 px at
  phone width; the `.add-item-ctl` row is two lines now, the product full width on top and its
  quantity / price / ✕ controls under it.
- **A journal behind every figure** (v109, v111) — a Money figure (Cash in / TNG in / Cash out /
  TNG out, a loan line) and a Profit & Loss running-cost line are tappable and open their journal
  for the stretch: the rows the Money screen wrote, in date order, each with what it was for and
  how it was paid. v109 also fixed a real bug — the TNG column matched the old lower-case `"tng"`
  while the paid buttons write the list's own label `"TNG"`, so every TNG payment since v106 fell
  into *Paid, no method*. `accounts.js` `methodLabel()` is the normaliser that keeps them together.
- **Ingredients you never buy** (v110) — `ingredient.notPurchased === true` marks labour,
  electricity, gas and the owner's own time. `admin/js/purchasing.js` `priceItems` drops those
  rows at the one door every shopping list goes through (and `.filter(Boolean)`s them), while
  `notPurchasedNames(state, bomItems)` lets a list say *"Not on this list: …"* rather than look as
  if it forgot. The recipe cost is untouched — the cost still runs into the P&L cost of sales. The
  switch and the *Not bought* card line live in `admin/js/views/ingredients.js`.
- **A book for every way you pay** (v113) — a new **Books** line on the Money screen lists *every*
  method, including a pocket that moved nothing in the stretch on screen and so never got a row
  on the money card. Each book opens under the line that was tapped.
- **Pay back a pocket** (v112) — a pocket that paid for something shows a negative line (the till
  owes it). **Pay back a pocket** writes both halves in one go: money out of the till *and* the
  pocket's line cleared. The till's side is recorded as a withdrawal, so it never counts as a cost
  and profit does not move. The same version fixed the category pills, which were laid out on one
  line and ran 744 px wide inside a 343 px box on a 375 px phone — they wrap now, and so do the
  ways-to-pay row and the pay-back form.
- **Every spending line opens; the rows are finger-sized** (v114) — `renderProfit` used to pass
  `opens: null` for a line whose amount was `0.00`, on the reasoning that there were no rows behind
  it. But the row was drawn identically to a live one, so a month of mostly-empty categories read as
  a broken screen. Every spending line is now tappable, and `openExpenseJournal` handles the empty
  case by naming the category and the month ("Nothing recorded under Utilities in September 2026")
  with its In / Out / Net at zero and a footer explaining it fills itself. The statement's own totals
  (Sales, Cost of sales, Gross profit, Net profit) stay figures, not doors. `.info-row.tappable` gains
  `min-height: 36px` (measured 17 px), and the **Total expenses** journal — which mixes categories —
  now prefixes each row with its category via `whatOf(r)`, while a single category's journal stays
  short since its title already says which one.
- **The Profit month arrows** (v115) — `canNext` was computed once in `renderProfit` before `draw`
  ran, and `draw` then reused it, so stepping back a month left the forward arrow disabled at the
  state it had on the month the screen opened on. Both `now` and `canNext` are now computed inside
  `draw`, so the arrows move both ways (and the forward one disables again only on the current month).
- **Day one — the opening balance** (v116) — `openDayOne(state, redraw)` in `admin/js/views/money.js`,
  reached from the **Day one** line under **Books** on the Money screen. It asks for the cash in the
  tin, the money on the phone, the date the books begin, and one box per ingredient for what is
  already on the shelf. The tin and the phone are written as ordinary `state.deposits` rows (so the
  Money screen's net is right from the first day and nothing new has to understand them); each stock
  box sets `ingredient.onHand`, which the shopping lists already subtract. Boxes are typed in the
  unit she keeps that ingredient in — two small helpers were exported from `views/ingredients.js` for
  that, `currentUomId(state, ing)` and the already-exported `cookingFamilyOf(...)`, so the form
  offers the units of the same family and converts with the ingredient's own `toBase`. Every box is
  validated **before** anything is written, so a bad value half-way down saves nothing at all, and an
  empty box is skipped entirely (reopening the form to fix one figure never wipes the rest).
  Ingredients marked **not purchased** are left out — they have no shelf.
- **The Paid step when a regular pays at pickup** (v117 → v118) — v117 dropped the Paid step from
  the journey of an order that skipped it (`journeyMarks` returning one mark fewer) and kept the
  Paid · Cash / Paid · TNG buttons on at every stage from Paid onwards. v118 replaced the dropped
  step with a **skipped** one on the owner's instruction: the step keeps its place and wears an X
  (`.oj-cross` / `.tj-cross`), so every order's map is six steps in the same places and a step
  *deliberately gone past but not paid* is distinguishable from one not yet reached. The three
  helpers are the ones to read: `PAID_AT` (`STATUSES.findIndex` / `JOURNEY.findIndex`), the
  `paidSkipped` flag (`!paidDone && at > PAID_AT`), and the `done` array + `live` flag that walk the
  marks. `store/app.js` mirrors it exactly, so the customer's track page draws the same six steps.
  `STAGES_AT_OR_PAST_PAID` also gate the status dropdown: picking Paid **or any later stage** on an
  order that has no recorded payment marks it as owing money.

**Sync.** `expenses` and `deposits` join `LISTS` in `admin/js/sync.js`, so money out and money in
travel between the owner's phones like every other list. **One upstream gap, ported faithfully and
flagged rather than papered over:** `state.js`'s comment on `categories` / `payMethods` says both
lists are shared between phones, but `sync.js`'s `recordPayload("settings", …)` whitelist names
neither — so today they are **phone-local**. Do not "fix" this in jerky alone; it wants a change on
the bakery first, then a sync.

## The till, a tappable Next-available line, and picking dates fast (v99–v102)

Four versions, three of them about doing a small job with fewer taps.

- **Money, recorded as it lands** (v101) — a new pure module `admin/js/money.js`
  (`groupValue`, `isCollected`, `methodOf`, `deliveryOf`, `paidOf`, `dayMoney`,
  `moneyBetween`) behind the day header's till line and the new
  `admin/js/views/money.js` screen (*More → 💰 Money*, route `#/money`). Cash and
  TNG each get their own `Paid · Cash` / `Paid · TNG` button on the row
  (`markPaid(state, group, root, dateId, method)`), `paidMethod` + `paidAt` are
  written on the order, and the Note / tracking pop-up gains a *Paid by* select
  (`openNoteTrackingPopup` → `Paid by`). The counting rule is the point: **collected
  money is bucketed by `paidAt`** (falling back to the delivery date for an order
  paid before v101), **still-to-collect by the delivery date**. An order paid with no
  method recorded lands under *Paid, no method* rather than being guessed at.
- **A price on the order line** (v101) — every item line on the ＋ New order form and
  in the Edit pop-up now carries its own price box. It seeds from the product's menu
  price; typing over it sells *that* order at that price, and every reader
  (`confirm.js`, `messages.js`, `customers.js` spend, the track card, the money
  screens) already prefers the frozen `unitPrice` from v70, so nothing downstream
  needed to change. Blank means "whatever the product costs".
- **The Next-available line takes the day** (v99) — on the shop, a kept-listed
  product's `Next available: Sat 19 Sep` line is a control: `store/app.js` gives it a
  click handler that calls the same `pickDay(day, { scroll: true })` the calendar
  uses, then scrolls the calendar into view (`registry["dates"].scrolled`). With
  anything in the basket the line keeps `.off` and tapping it writes a note instead
  — `nextBlockedBasket` in `store-lang.js` ("Your basket is for %1. To order for
  another day, choose it on the calendar above." / 你的购物袋是 %1 的 / Bakul anda
  untuk %1) — because taking a day would silently move the whole basket and drop
  whatever no longer fits.
- **Delivery dates, one tap or a swipe** (v100, v102) —
  `admin/js/views/deliveries.js`: a **weekday letter** in the calendar header is a
  button that picks (or unpicks) every one of that weekday in the month shown, and
  `Generate the next dates` — which used to live only inside Home's "no dates yet"
  message, and so disappeared the moment it worked — is now always on the screen,
  following `settings.deliveryDays`. v102 adds **drag-to-select**: `drag-sel` cells
  fill under the finger and `Add selected` commits the run, the same gesture a
  product's sell days use. Deliberately **no From/To pair** here — a delivery date is
  one day, where a sell period genuinely has two ends. `admin/js/dates.js` gained
  `dayListLabel` so Home's empty state and the line under Generate name the owner's
  own `deliveryDays` instead of a hard-coded "Mon/Wed/Fri".

## The last status, and a posted order's tracking number (v97–v98)

The final step of the journey and the two fields the owner reaches for most.

- **One label covers both endings** (v97, revised v98) — the last `STATUSES` entry
  is a single `["delivered", "Collected / Posted"]` (the `delivered` id is kept;
  only the label changed). v97 named it per order — *Collected* on a `collect`
  order, *Shipped/Posted* on a `courier` one — and v98 collapsed that back to the
  pair, which is what the owner asked for. So every place the step is named reads
  the same: the row's status list, `journeyMarks`, the day's status filter and the
  customer's `JOURNEY` map in `store/app.js` (last entry `["delivered", "trkFinal"]`,
  keyed `trkFinal` in `store-lang.js` — 已取货 / 已寄出, Telah diambil / Telah dipos).
  Which message the row offers is still decided by `fulfillment`, not the label.
- **A tracking number on the order** (v97) — `first.trackingNo`, trimmed at the
  ends and otherwise kept as typed (a pasted number may carry spaces or dashes and
  the courier's site is fussy about it). It is written by the Edit pop-up's
  *Courier tracking number (optional)* box and by the v98 **Note / tracking**
  button (`openNoteTrackingPopup`, `views/orders.js`), which carries exactly the
  Note and the tracking number and publishes the card when the number changed
  (`applyPopupEdits` compares `trackingBefore` with the saved value).
- **A posted message** (v97) — `buildShippedMessage` (`admin/js/messages.js`) is
  the third later-stage message, beside the payment and pickup reminders. It runs
  through the same `basics()` (so it carries the order code, the frozen sold names
  and prices, and the postage line), adds the tracking number only when there is
  one, and returns `null` without a WhatsApp number. Offered only on a `courier`
  order, from `shippedMsgButton`; a `collect` order keeps the pickup reminder.
- **The customer sees it** (v97) — `trackingSnapshot` (`admin/js/supabase.js`)
  publishes `tracking_no` (the trimmed number, or `null`), and `paintTrack()`
  (`store/app.js`) draws `.track-no` under the delivery details from the
  `trackingNo` i18n key when the row carries one. A self-collect order never has
  one, so it never shows the line.

  **The lookup has to ask for it.** The track box builds its own PostgREST URL
  and PostgREST returns **only the columns named in `select`** — v97 added
  `tracking_no` to the row and to `paintTrack()` but not to that `select`, so
  `row.tracking_no` was always `undefined` and the line could never draw (the
  bakery's `store/app.js:1308` has the identical omission — fixed in jerky, worth
  flagging upstream). Any future column added to the card must be added to that
  query too; `test/store.test.js`'s tracking-number test asserts the request URL
  names `tracking_no`.
- **SQL** — `supabase/track_no.sql` (`alter table order_tracking add column if not
  exists tracking_no text;`) is the **one** database line this pair of versions
  needs; it is folded into `supabase/tracking.sql` for a fresh setup. Until it is
  run, the number still reaches the WhatsApp message and the app; it simply does
  not land on the customer's page yet. Unlike every sync since v62 this one is
  **not** code-only.

## A day's capacity counts what you sell that day (v94–v96)

- **One sentence, reworded** (v94) — the greyed line on a card the owner keeps
  listed now reads *"Only available on %1"* where it read "Only sold on %1"
  (`store-lang.js` `closedWeekday`, en/zh/ms — the Chinese and Malay already said
  the equivalent). Wording only; no behaviour change.
- **Capacity counts sellable products only** (v95) — `effectiveCapacity()` is now
  a thin wrapper over the new **`dayCapacityParts(state, dateStr, overrides)`** in
  `admin/js/bom.js`, which returns `{ parts, counted, off, total, fallback }`. Only
  products `sellOpen(p, dateStr)` are summed (`sellOpen` from the shared root
  `availability.js`, the same copy the shop reads), so a product not sold that day
  adds nothing. A product with no sell marks answers true and therefore counts as
  before; a date that is not a real day key also answers true, so no existing
  caller changes. When nothing limited is on sale the day falls back to
  `settings.defaultCapacity` — never 0, which would read as Sold out. **Knock-on:**
  the same total is what the shop is told, so a day reaches FULL once every
  sellable unit is booked rather than once a padded menu-wide number is.
- **The pop-up shows its working** (v96) — `openDayAdjustPopup` (`views/orders.js`)
  gained a `paintSum()` block: it feeds what the owner is typing into
  `dayCapacityParts` as `overrides` and draws a `.cost-grid` — one `+`/`·` row per
  counted product, then a `=` total row naming what the order page can take. Below
  it, a "Not counted: …" line for the `off` products and a "Booked so far" line.
  Repaints on every `input`. No CSS was needed: the `.cost-*` classes already exist
  for the product cost recipe.

### A `null` child is not a skipped child

Found while verifying v96 and fixed in the same pass: `replaceChildren()` does not
behave like `el()` — a `null` argument is **stringified into a literal `"null"`
text node**, not dropped. So `replaceChildren(a, cond ? b : null, c)` prints the
word **null** on the page whenever `cond` is false, and the same is true of
`append()`. Two places were reachable: the v96 day pop-up (printed "null" between
the total row and the "Booked so far" line whenever every product on sale that day
was counted — the usual case, because the optional "Not counted" line was absent)
and `renderSettings` (printed "null" at the bottom of the screen under *Delete all
data* whenever `sampleCard` is null, i.e. once there is any product or ingredient).
A third, latent one sits in `admin/js/datepicker.js`: the optional Today button
(`todayShortcut` is `true` for every current caller, so it is unreachable today).
Both reachable ones exist identically on the bakery — flag them upstream.

The fixes wrap the optional child: `...[a, cond ? b : null, c].filter(Boolean)` or
`...(x ? [x] : [])`. Because the engine sync re-copies these files wholesale, those
edits have to be re-applied on the next copy of `views/orders.js`,
`views/settings.js` and `datepicker.js`.

`test/no-null-text.test.js` guards the class: it renders the day pop-up (both
branches) and the Settings screen through a **strict** `replaceChildren` shim and
fails on any `"null"`/`"undefined"` text node. The other test shims filter null
children (matching `el()`), which is exactly why the defect survived here — the
real browser does not.

## The track link lands on the card, lit (v93)

The WhatsApp confirmation carries `/store/?track=CODE`. Until v93 that page opened
at the top with the track card below the fold, so the customer had to hunt for the
thing they had just tapped.

- `store/index.html` wraps the heading + card + result in a **`<section
  id="track-section">`** so it can be aimed at and lit as one unit.
- `revealTrack()` (`store/app.js`) runs only when the page was opened with a
  `?track=` code. It adds `.hit` to the section and calls `aimAtTrack()`
  (`scrollIntoView({ block: "start", behavior: "smooth" })`).
- The glow ends on **the pointer arriving** — `TRACK_SETTLE_ON` (`pointerenter`,
  `pointermove`, `pointerdown`, `mouseenter`, `touchstart`), self-removing once it
  fires. Never a timer: a fixed moment can pass while the eye is still travelling.
  This is the same rule the backoffice uses when it jumps to an order
  (`admin/js/views/orders.js`).
- It aims **twice**: once on open, and once more from the first data refresh
  (`trackAimPending && trackLit`) — the published config and the day's counts
  land a moment later and make the page taller, so the first scroll stops short
  (measured at 375px: 113px up the page from the card). Only this first pass: the
  30 s poll must never pull a customer back.
- `store/app.css` carries the `track-glow` keyframes, with a steady lit card under
  `prefers-reduced-motion`.

A customer who simply opens the shop gets no glow and nothing moves.

## Order tracking & confirmation (Supabase)

Customers choose **Post (nationwide)** / **Collect (local)** when ordering (a
posted order asks for the postal address) and leave their **WhatsApp number**, so
the owner can confirm the order back to them. Orders show the time they were
placed ("Placed 1 Sep · 14:32"), the fulfilment method and the address.

Every order row shows its own **status map** (New → Confirmed → Paid → Preparing
→ Packed → Delivered): steps behind the order are green with a tick, the step
waiting on the owner is the pulsing amber dot, and a Delivered order is all
green. Each stage has its own action, and each WhatsApp message leads with the
order's number (e.g. `#A3F9C2`) so it can always be matched back to the order:

- Move an order to **Confirmed** → tap **Send confirmation** — WhatsApp opens
  with the order number, delivery details, items + total (posted orders include
  the **flat postage** on the To-pay line), a **TNG QR** payment request, and a
  **track link**. The customer opens that link and sees the live status and their
  method/address. The **TNG QR travels in the WhatsApp messages only** — the
  confirmation and the payment reminder — never on the shop: the order page tells
  customers the QR arrives over WhatsApp, and nothing on it draws a payment code.
  (The setting still publishes and adopts through Supabase — that row is how it
  syncs between phones, not a shop surface.)
- Move it to **Paid** → **Send payment reminder** (a WhatsApp nudge with the
  order number + QR) and **Paid** — tap **Paid** only once the TNG receipt has
  really come back.
- **Preparing** has no message — the map just advances. Move it to **Packed** →
  tap **Send posting reminder** (or "Send pickup reminder" for a collect order).
  **Delivered** finishes the order; the whole map goes green.

The order number tag (`#A3F9C2`) appears on every inbox row, every order row, and
the Edit pop-up; every item in the same storefront cart shares one number.

- The track page updates automatically whenever the status changes.
- Set the TNG QR (a hosted image URL) in **Settings → Storefront → TNG QR code**,
  and the flat postage in **Settings → Storefront → Postage (nationwide posting)**.
- **Edit** opens a small pop-up over the screen and lists every product,
  including hidden ones (marked "(hidden)").

**One-time setup:** run `supabase/tracking.sql` in the SQL editor.

## Shared data across phones (cloud sync)

The owner may take orders at home and at a market, on two phones. **Shared data**
keeps the same orders, products, ingredients, posting dates, purchase orders and
settings on every phone that signs in to the same Supabase project.

How it works: the app stays local-first. Each phone keeps its own copy in
localStorage, and every change syncs automatically (~1.5s after you make it).
The other phone catches up within ~30 seconds, or immediately when the app
regains focus/connection. It works offline: edits made with no signal are queued
and pushed when the connection returns.

The rule for two people editing at once: **newest edit wins per record**.
Editing *different* orders is always safe; editing the *same* order offline, the
later edit wins. For a two-phone home business that's the right trade-off.

**One-time setup (after Live availability is working):**
1. Dashboard → **SQL editor** → open `supabase/backoffice.sql` → **Run**.
2. Dashboard → **Authentication → Users → Add user** — add *another* user for
   the second phone.
3. Backoffice → **More → Settings → Shared data (cloud)** → flip *Enable shared
   data* on. The app restarts into a sign-in screen: paste the Supabase URL +
   anon key (same ones as Live availability) and the app login, then **Sign in**.
4. On the second phone, open the same URL → **Settings → Shared data → Enable**
   → sign in with its own account.

The connection config (URL, anon key, login) is per-phone and isn't synced, so
each phone signs in with its owner's account. The app-login email/password is
never embedded in the code — she types it in once per phone.

### "Not sharing right now" strip

Whenever a phone is *not* on the shared cloud — shared data turned off, the
phone never set up, or signed out — a thin amber strip sits at the very top of
every screen: **"⚠ Not sharing right now"**, with a one-line reason and a **Fix
it** tap that jumps to More → Settings → Shared data. The strip does not lock
the app (unlike the app password) — she can keep working — and it disappears on
its own the moment the phone is sharing again, without a reload. A phone that is
off the cloud still makes and keeps its own local backups.

## Cloud backups (Supabase)

A real safety net behind the sync mirror. Shared data holds only the *current*
state; cloud backups hold **history** — a dated copy of everything she can step
back to. Every time she opens the app while signed in, it quietly saves a full
snapshot of the backoffice (orders, products, ingredients, POs, credits, the
posting-date calendar, storefront copy) to her own Supabase cloud:

| Copy | When it saves | Kept |
| --- | --- | --- |
| Daily | the first time the app opens each day | newest 7 |
| Weekly | the first Monday of each week the app opens | newest 4 |
| Monthly | the first time the app opens on the 1st | newest 3 |
| Manual | the "Back up to cloud now" button, and one "Before restore" copy saved before every restore | until she deletes it |

The retention prune keeps the table small; older automatic copies are dropped,
manual ones stay. Everything lives under **More → Settings → Backup & safety**
(the existing card, renamed). Each listed copy can be:

- **View** — a read-only look inside that one copy: its orders grouped by
  delivery date (customer, product, quantity, status), the product price list,
  and ingredient stock at that time, plus how many suppliers/units/POs/credits
  it held. Nothing is ever written — confirming a June price moves nothing today.
- **Restore** — steps her phone back to that copy, then the sync engine rewinds
  the shared cloud and her other phone to match (records that only exist after
  the copy are seen as removed and stay removed). A **"Before restore" copy is
  saved first**, so a restore is never one-way. Like any sync, it is still
  last-write-wins at the record level: a change another phone makes *after* the
  restore and syncs will win back over that record — a step back, not a
  delete-the-future.
- **Download** — saves a real file named
  `furkidz-backup-2026-09-08-daily.json` (date + kind). Downloads use the
  same envelope as Export, so they **re-import through file Import** too.
- **Delete** — removes that one copy (the owner's choice; nothing is ever
  pruned automatically after a manual keep).

A copy is the same coverage as an Export file **minus the per-device settings**
(`settings.supabase`, `.cloud` and `.lock`) — the app-login email/password and
the app password never leave the phone, so restoring on another phone keeps
that phone's own sign-in, cloud switch and lock. The "Back up to cloud now"
button and the daily guard marker make the automatic cadence silent: an offline
day is skipped, not retried in a loop, and the next open on a new day tries
again.

**One-time setup:** run `supabase/backups.sql` in the SQL editor (adds the
`backup_snapshots` table + row-level security: only signed-in bakers can read or
write copies).

## Customers tab, profiles, finder & the wish list

**Customers** is a tab of its own (swapped with Purchase Order, which now lives
under **More**). It is the automatic customer book — one row per person with
their order count, rough spend, favourite product and last order — and it adds:

- **Finder** — type 2+ characters (name, WhatsApp number, a pet's name, a like,
  a note, a favourite product) and the list narrows live with "N of M match",
  the same way "Find an order" works on Orders.
- **Profiles** — tap a person and their history pop-up leads with a **profile
  card**. Edit (or "Add details") opens a form: name, WhatsApp, their pet's name,
  a **photo** (shrunk to a small ~200px thumb before saving, by `js/photo.js`),
  what they like, what to avoid, and a note. The **name and WhatsApp number are
  held once and kept in step**: saving them on the card writes them onto every
  order that person has, and fixing them with Edit on an order writes them back
  onto the card — either place works, and whichever was edited last is what
  labels, WhatsApp messages and the customer list show. Profiles live in a synced
  `customers` collection (`js/profiles.js`), keyed by the same trimmed/
  lowercased WhatsApp-or-name rule the customer rows use, so they ride shared
  data to both phones — a foundation for a future AI chat. Photos stay
  thumb-sized on purpose: the whole app state lives in one ~5 MB localStorage key.
- **Software wish list** (bottom of More) — behaves like the weekly to-do: add
  a feature you'd like, tick the ones that come true (ticks persist — never
  reset weekly), reword or remove. Stored lazily in `settings.wishList`
  (`js/wishlist.js`) with the same sync absence-guard as the to-do tasks, so a
  phone that never opens it can't wipe another phone's list.

A small green **Engine v##** pill on the More screen shows which build a phone
runs, and **Full change history** links to `changelog.pdf` at the root of the
site — a PDF of every version from v54, built from `CHANGELOG.md` by
`marketing/build_changelog.py`. No SQL was needed for any of this.

**The site speaks three languages (Engine v64+).** The homepage and the
storefront order page each carry a language switch (English / 中文 / Bahasa
Malaysia) that re-translates the whole page on the spot and remembers the choice
per visitor (`i18n.js` shared loader, `home-lang.js` + `store-lang.js`
dictionaries, `home.js`/`store/app.js` apply them; a product can carry
`nameZh`/`nameMs` shop names that dress up its card while orders keep the
English name). The published homepage reviews render as a swipeable carousel,
and **Settings → Website & developer** sets a "Website by …" credit on the
homepage + order page footer and More → About — the same developer receives the
software wish list, posted to the optional `wish-mail` edge function
(`supabase/functions/wish-mail/`) with an always-works mailto row as fallback.
**Engine v65** made **More → Reviews** a review-at-a-time moderation carousel
(waiting-to-publish first) with an "N waiting" pill on Home and the More menu.
**Engine v66** made product shop-text (name, description, selling unit, feeding
tip) auto-translate into 中文 and Bahasa Malaysia via the free MyMemory API —
machine values tagged "auto", typing over a box makes it hers (`translate.js`,
provenance in `trOverride`/`trSrc`) — gave products **three states** shown as
three lists (Draft / On the shop / Hidden; a new product starts as a draft via
`productState.js`), and gave the "Copy follow-up" referral message an
EN / 中文 / BM choice (`followup-lang.js`, `i18n.js` `descFor`/`servingFor`/
`unitFor`). Like v62–v65 this is all code — no SQL.

**Engine v71** made the order page's language switch **in place**: tapping
English / 中文 / BM repaints the page instead of reloading it, so nothing is
re-fetched (the menu, the "only N left" numbers, the saved order-page settings) and the
customer's basket, chosen posting day and typed details survive. `render()`
assigns a `repaintForLang` hook (tagged static HTML + title via `applyTo`,
`renderStatic`, `rerender`, `renderBar`, and the track card from its cached
`lastTrack` via `paintTrack`), and the exported `setLang(lang)` runs it and moves
the pill highlight — so a switch never re-enters `render()` and never reloads.
`i18n.js` gained an `isLang` guard. Code-only, no SQL.

**Engine v72** closed the last two English-only corners of the order page: the
note on a product that can't be ordered for the chosen posting day (only from a
date, only up to one, or orders close so many days ahead) and the notes a
refresh writes above the menu when it has to change a basket (something just
sold out, or a quantity trimmed to what is left). `store/pool.js` now returns
the date **rule as plain data** (`{kind: "from"|"to"|"close", …}`) instead of a
finished English sentence — its unused `humanKey` is gone — and `store/app.js`
composes the sentence from nine keyed strings in `store-lang.js`, with the date
written by the already-localized `fmtDay`, so no English weekday can leak into a
中文 or BM page. `test/store-i18n.test.js` now holds those keys and their `%1`
placeholders together: a new customer-facing string is not done until it is
keyed in all three languages. Code-only, no SQL.

## Host it free — Netlify Drop

For both phones to open the same URL:
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the `jerky` folder into the page → Netlify gives you
   `https://<name>.netlify.app`.
3. Open that URL on both phones (the app loads offline once visited, so a weak
   signal doesn't block order entry).
4. Customers order from the same URL plus `/store/`.

## Handoff to the owner

**Two phones that share data:** follow *Shared data across phones* above — no
backup files needed.

**One phone only (or a fresh phone to preload):**
1. On your machine: add her real ingredients and products → **Settings → Export
   backup**.
2. Send the `.json` to her (e.g. WhatsApp).
3. She opens the live URL on her phone → **More → Settings → Import backup**.
4. She exports a backup weekly (**Settings → Export**) — that file is her
   data-loss safety net if the shared cloud is ever reset.

There's a **Load sample data** button on a fresh install so she can see how it
works before entering anything real (sample products: Chicken Jerky, Duck Jerky,
Sweet Potato Chews).

## Data & privacy

By default all data is stored in the device's browser (localStorage) — no
account, no cloud. The two opt-in Supabase features publish/echo data to her own
Supabase project: **Live availability** uploads slots-left counts (readable by
anyone, so the storefront can show them), **Shared data** mirrors the full
backoffice data with **row-level security: only signed-in bakers can read or
write it**, and **Cloud backups** stores dated snapshot copies under the same
row-level security (signed-in bakers only). Backup files and the app login
password are stored in the app's local storage on her phone.

## Tests

```bash
node --test test/*.test.js
```

Tests cover the pure modules (`admin/js/bom.js`, `admin/js/dates.js`,
`availability.js`), the sync engine (`admin/js/sync.js`), the app bootstrap +
sign-in gate (`admin/js/app.js`), the storefront (`store/app.js`), and the
shop's calendar copy (`store/calendar.js`, pinned against the app's own by
`test/store-cal.test.js`).

The QR encoder is the one thing that has to be right, so `test/qr.test.js`
checks it three ways: **frozen golden matrices** for fixed inputs, **structural
invariants** (finder patterns, timing alternation, the always-dark module, the
format bits written twice and equal), and **Reed–Solomon known-answer vectors**.
The real acceptance test is the owner scanning a printed label with her phone.

Two suites guard things a normal assertion cannot. `test/no-null-text.test.js`
renders the day pop-up and the Settings screen through a **strict**
`replaceChildren` shim (every other shim filters nulls, which is exactly why a
stray `null` text node survived so long) and fails on any `"null"` /
`"undefined"` text node. `test/courier-provider.test.js` walks `admin/js` and
`supabase/functions/courier`, strips comments, and fails if any file but the
registry and the provider itself names the courier — see the sync section above.

## Files

```
changelog.pdf       full change history (every version from v54, PDF) — root of the site
index.html          public homepage (domain root) — trilingual, data-i18n tags
home.js             homepage logic: i18n apply + carousel + reviews boot (module)
home-lang.js        homepage dictionary (en / zh / ms)
i18n.js             shared language loader (LANGS, loadLang/rememberLang, applyTo)
reviews.js          homepage reviews fetch + carousel + review form (root module)
availability.js     sell-day rules for a product — shared by the app and the shop (pure)
store/index.html    customer order page (/store/)
store/app.css       storefront styling
store/app.js        storefront logic + order intake + availability + published config
store/calendar.js   the shop's own month-grid + mark helpers (a copy of the app's)
store/config.js     fallback name, WhatsApp, menu, days, supabase (overridden by Settings → Storefront)
store/pool.js       shared-pool rules: pack components, cancel windows, sell days (pure)
store/geo.js        a courier order's pickup point + label; null for a collect order (pure)
store/lookup.js     address lookup — asks her own Supabase function, never a public geocoder
store/pin_map.js    the map the customer drops a pin on (customer's own door as a point)
storefront-fields.js  the shared field whitelist both publish paths import (root module)
store-lang.js       order-page dictionary (en / zh / ms)

admin/ — backoffice app (/admin/):
  index.html          entry (bottom nav shell)
  css/app.css         backoffice styling
  css/print.css       prints only the PO card
  js/state.js         schema, localStorage load/save, ids, formatting, order-line snapshot
  js/dates.js         posting dates, cut-off, countdown (pure)
  js/qr.js            QR encoder — matrix / SVG string / PNG bytes, no DOM, no deps (pure)
  js/money.js         what came in — cash / TNG / still to collect (pure)
  js/courier.js       the courier charge, who bore it, and the customer's total —
                      the flat postage it replaces, the COD split, apply / clear (pure)
  js/profit.js        the books — sales, cost of sales, running costs, capital / drawings (pure)
  js/accounts.js      the categories and ways to pay the books read, and their built-in defaults (pure)
  js/bom.js           BOM explosion, costs, capacity (pure)
  js/production.js    a production day: people, hours, pans, the slowest station (pure)
  js/scenario.js      the line as modules / batches / cycles; climb to the day you want (pure)
  js/bakeday.js       a bake day worked backwards from the oven moment (pure)
  js/couriers.js      the courier REGISTRY — the only app file allowed to name a provider
  js/courier_job.js   booking a courier job: price, sign, place, follow (pure where it can be)
  js/courier_place.js a job's pickup / drop points, and the addresses they came from
  js/place_map.js     the map that shows and edits a stored point
  js/parcel.js        a parcel: a box she posts herself, with a carrier frozen on the order (pure)
  js/productCategories.js  the category tree: flat records + parentId, stored sort (pure)
  js/supabase.js      live availability + storefront config publish, order intake
  js/sync.js          shared-data sync engine (queue, pull-then-flush, conflict)
  js/backups.js       cloud backups (auto daily/weekly/monthly snapshots, restore)
  js/sharewarn.js     "Not sharing right now" amber strip (top of every screen)
  js/validate.js      import-file validation
  js/ui.js            DOM builder + shared render helpers
  js/wishlist.js      software wish list on More (lazy settings.wishList CRUD)
  js/devmail.js       builds the wish-list email + developer contact links (pure, sends via wish-mail)
  js/profiles.js      customer profiles (join to the customer rows, pure; digits-keyed
                      identity, canonicalise/merge — v120)
  js/photo.js         shrinks a picked photo to a small thumb (browser only)
  js/suggest.js       right-arrow / tap-to-accept for a greyed suggestion (data-suggest)
  js/calendar.js      month-grid + occasion helpers (shared by every calendar)
  js/occgrid.js       draws a marked day on every app calendar (one shared look)
  js/datepicker.js    the date control behind the app's three date fields (expands in place)
  js/app.js           hash router + bootstrap + shared-data gate
  js/views/*          one module per screen (login.js is the sign-in gate)
  sw.js               service worker — offline app shell (/admin/ scope);
                      only a navigation falls back to the cached index.html
  manifest.webmanifest PWA manifest for the backoffice

supabase/availability.sql   run once in Supabase SQL editor (public slots)
supabase/backoffice.sql     run once in Supabase SQL editor (shared data, RLS)
supabase/backups.sql        run once in Supabase SQL editor (cloud backup snapshots, RLS)
supabase/storefront.sql     run once in Supabase SQL editor (storefront config + order intake)
supabase/reviews.sql        run once in Supabase SQL editor (homepage reviews + photo bucket)
supabase/tracking.sql       run once in Supabase SQL editor (order tracking)
supabase/track_no.sql       run once — adds order_tracking.tracking_no (v97; folded into tracking.sql)
supabase/courier_fee.sql    run once — adds order_tracking.courier_fee (v124; see courier_cod.sql)
supabase/courier_cod.sql    run once — adds order_tracking.courier_cod (v124)
supabase/courier_job.sql    run once — the table behind booking a courier job from the app
supabase/postage_mode.sql   run once — adds order_tracking.postage_quoted (the flat/quote switch)
supabase/functions/wish-mail  optional edge function: emails the wish list to the developer
supabase/functions/courier   optional edge function: prices and books a courier job, geocodes,
                            and suggests addresses (suggest.ts — needs Places API (New))
supabase/functions/shop-geocode  optional edge function: address → map point, under her own name
test/               node --test suites (import from admin/js and store/)
marketing/          social-media marketing guide generator (gitignored)
```
