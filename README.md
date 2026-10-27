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
- `supabase/sync_cursor.sql` — the `bakery.seq` row cursor that makes incremental sync possible (v533)

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

## The Guide was printing its own markup (7 Oct 2026, no engine bump)

Found while checking the availability fix above. The Guide's cards are written with `**double
asterisks**` round the words that should stand out — and **nothing in the app ever rendered them**, so
every card that used them showed the asterisks themselves. 37 paragraphs, for as long as the Guide has
existed; a pass that presses every control cannot see it, because the screen renders fine, it just
reads wrong.

Fixed with a **`boldify(root)`** pass at the end of `renderGuide` in `admin/js/views/guide.js`: it walks
the finished screen, turns each `**pair**` into real `<strong>`, leaves a lone `*` alone, and skips a
paragraph with an unpaired `**` rather than half-converting it. It works on both the browser DOM
(`childNodes` + `replaceChild`) and the test shim (`children` array).

**Pinned by a new check in `test/press-everything.test.js`** — renders the whole Guide, fails if any
paragraph still prints its own markers, and also requires the real emphasis to be there (a guard that
only counted asterisks would pass on an empty screen). **Bitten:** with `boldify(root)` commented out it
fails with *"no paragraph on the Guide may print its own \*\* markers"*.

## v600–v602 — a stale Removed row is dropped by the pull, and a half-written stamp repairs itself (19 Oct 2026)

**Her "Check my system" named two orders on the live list AND the Removed list. The query she ran showed
the same ids in `orders` and `removedOrders` in the shared data — not a phone-side tidiness problem.**

⚠️ **The invariant existed but on the wrong paths.** `normalize` applies `dropStaleShelfRows` on load,
and `mergeRows` applies it after a merge (v474) — **but `pull()` goes straight to `mergeCloudRows`**, so
the thirty-second pull handed the stale rows back after every open and the check went red on every run.
⭐ It also left **two records wearing one order id**, which is why Save + Paid on `AC8542` did not settle.

**Fix:** `const dropped = dropStaleShelfRows(state)` in `pull()`, folded into `save()` and the returned
`changed` — the same two lines `mergeRows` has used since v474. Dropping queues the tombstone, so the
removal travels and the shared data stops handing the row back.

**v601–v602 (two further commits — each half landed after the last was pushed):** her order `AC8542` had `paidReceived` on one line and `null` on the
other. **The Pay press is only offered while the FIRST line is unpaid**, so there was no button that
would write it — and every money book reads the order through that first line, which already said
paid. **`equaliseOrderLines(state)` repairs it at the same three seams** (v601 for the payment, v602 for a stamp) (load, `mergeRows`, `pull`):
when the first row says paid, every row of that sale is paid and the method and day follow. ⚠️ **It
never works the other way — an unpaid order is never marked paid.** **A STAMP (`promo`, `receiptNo`) is
filled where a line has none and never overwritten where it has its own** — so a real disagreement still
shows on the check (v602: the check named `promo` on AC8542 once the payment was settled). Its receipt number is also still the Invoice press's second chance.

**Guards:** `test/sync.test.js` (two — the pull drops the stale row and queues it; the pull settles the
half-written payment) and two unit tests in `test/order-removal-guard.test.js`. Both pull tests wire
the save hook by hand (app.js wires it in the real app); **each was watched failing before it was
kept.** Suite 3871 → 3875. **And a false alarm in the same check (v602):** `agree` compared order-level fields with
`JSON.stringify`, so `promo: ""` on one line and `promo: null` on the other — **both meaning no code** —
reported as a disagreement for ever. `sameValue()` treats absent, null and `""` as one fact; **`false`
and `0` stay distinct.** `test/health.test.js` pins both halves, watched failing.

**No SQL, no upload.**

## v549 → v599 — five more sweeps, and the last one found faults in the fixes before it (19 Oct 2026)

**Fifty bakery versions (v550–v599). 180 merged files + 27 new, +13,185 / −1,247 in the bakery's own
range. ⚠️ SQL and Edge Functions this time — see the deploy order below.**

**The shape of it:** an audit of what v542–v549 left, then a check of that check, five times. **Two
sweeps found faults created by the sweep before them**, which is why the last is a freeze rather than
a finish.

**Security (v558, v583, v585, v586, v589).** `track_order` now takes a **phone** as well as the code;
the SQL refuses a code-only read, so six characters no longer open a customer's name, address or
driver's phone. The backoffice publishes the phone onto every old card with one press. Two trigger
functions lose their default PUBLIC EXECUTE (`supabase/advisor_fixes.sql`), and `incoming_orders.data`
gains a size check.

**Money (v578, v579, v587).** A refund is money out in the month it went back, not the month of the
sale; one sale draws one invoice number even when its lines sit on two days; paying a pocket back is a
debt settled, not a withdrawal.

**Paper (v572, v575, v582, v588, v598).** Labels print at **100 × 150 mm**; an invoice names the
customer; and no instruction addressed to her prints on a customer's or a shop's sheet (the invoice's
"open this app again", the PO's unit warning) — both are `no-print` on screen instead.

**The shop (v565, v581, v588, v592, v593, v596–v599).** A number that cannot be answered is refused at
the box; the tapped day keeps the keyboard; a refused promo is re-judged; the homepage reads its
**cut-off and posting days from settings** and prices the product she picks (`homeProductId`); and the
after-order reset returns the page to the state a new visitor sees — **which for munchies is
`apply("courier")`, its own model, not the bakery's `apply("")`.**

**Stock and trips (v560, v563, v566, v568, v570).** Check my system names a stock card whose rows do
not add up to the shelf (the two "+10" rows of 17 Oct are explained by one action recorded on two
phones); eight stuck stock cards can be repaired; a trip cannot be booked twice; a booking that may
have gone through says "unknown" rather than "failed".

**The guards (v584, v591, v600-adjacent).** Several tests could not fail — they checked that a screen
*called* a helper, not that the helper worked. `test/v587`–`v599-repairs.test.js`, `i18n-keys`,
`imports-resolve`, `field-names`, `store-contrast` and `units` are the replacement guards.

## v603–v604 — the Edit card shows the whole sale, and a receipt number survives the other phone (19 Oct 2026)

**Found by the sweep for the same class as v600–v602.** The Edit pop-up built its lines from
`group.orders` — **the day's slice** — while its Save writes order-level fields onto every row of the
sale (`Object.assign(o, fields)` inside the per-line loop). ⭐ **So a sale spanning two posting days had
its other day rewritten without ever being on screen**, which is the state `agree` reports.

**Fix:** `lines` is `familyOfOrder(state, group.orders)`, and `dropIds` scans the family too — so a ✕ on
the other day's line really removes it (to the Removed list, as any removal). **The pairing that had to
change with it:** `_others` (the family rows added to the draft's worth) is now *family minus the draft's
own ids*; counting the old rows as well **double-counted them** (RM64 for an RM32 sale) and the "money is
in" question never appeared — **caught by `test/order-stage-whole-order.test.js`'s existing v598 test.**

**And the second sweep finding, shipped as v604 (v603 was pushed first):** `mergeCloudRows` deletes every key the incoming row
lacks, so **a newer copy from a phone that never learned a receipt number wiped it** (measured twice on
`AC8542`). ⭐ **A receipt is never rewritten**, so a local `receiptNo` is now carried onto the incoming
copy — **fill-only: a cloud row with its own number still wins.** Two tests in `test/sync.test.js`, the
first watched failing.

**Guard:** a new test opens the card on a two-day sale, asserts both lines are listed **and that the other
day's line can actually be changed**; watched failing on the old code. Suite 3877 → 3878.

## v671 — one bad number can no longer stop every product's count (27 Oct 2026)

**Her report:** *"Sync failed: Product sync failed (HTTP 400) — null value in column slots_left violates
not-null constraint"*.

⚠️ **JSON, not SQL: `Infinity` and `NaN` both serialise to `null`.** A limit or booked count that had gone bad
reached `product_availability.slots_left` as a null, the column refused it, and **because the batch is one
call, one row rejected every product's stamp**.

- `computeProductSlots` now runs every published figure through `whole()` — `Number.isFinite` else **0** (the
  direction that cannot oversell), plus a pack-size guard so `baseQty <= 0` cannot divide by zero.
- **`health.js` gains `numbers`** — *"Every count the shop publishes is a real number"* — naming the product or
  order carrying the unreadable figure. ⚠️ **"sync failed" with no name is a fault she cannot act on.**
- Two tests in `test/availability-agrees.test.js` (an `Infinity` limit publishes no null; a zero pack size
  divides by nothing). Health counts 26 → 27 / 14 → 15.

Suite 4020.

## v670 — the charge is called "Postage" (27 Oct 2026)

**Her instruction:** *"make the order card say postage"*.

⚠️ The order card's box was a hard-coded **"Courier charge (optional)"** while the customer's message used
`chargeLabelOf(state)` — **two words for one figure**, and the wrong one on a shop that posts parcels.

- `CHARGE_LABEL_DEFAULT` is **"Postage"** for this shop (the bakery's stays "Courier charge" — it runs a van).
- `courierControls` (order card), the refund row (`views/orders.js`) and the invoice's COD note
  (`invoice.js`) all read the same word, so renaming it in Settings moves every one of them together.
- `store-lang.js`'s `courierCharge` / `courierCod` are **Postage / 邮费 / Kos pos**. ⚠️ **These two shop
  strings are translated copy, not the setting** — a rename in Settings does not reach them, and the comment
  there says so.

39 assertions renamed across 9 test files. Suite 4018.

## v669 — the shop's Malay day word (27 Oct 2026)

**Her instruction:** *"change the malay to hari pos"*.

⚠️ **Two sentences still said `hari membakar` while the rest of the dictionary already said `hari pos`** — the
step, the calendar, the sold-out line and the "what is a posting day" note were right; the facts panel and the
closed-day sentence were the stragglers. A shop that dehydrates was telling some customers it bakes.

⭐ **And this is its own version number for a reason.** The copy change was first committed under **668**, half
an hour after 668 had been pushed — so a phone that loaded 668 before it would read "668" and quietly hold the
**old** Malay, and the update strip (which compares that number) could not tell. ⚠️ **A sticker has to move
whenever what a phone can see moves**, or it stops being evidence.

`test/store-i18n.test.js` forbids `hari membakar` **and** `hari penghantaran`, and requires `hari pos`.

## v668 — the bakery sync: a collection's day and time, the buffer, and a saved charge (27 Oct 2026)

**Range: bakery `f648adc` (their v649) → `9dc95f7` (v668), 17 commits, 32 files, +1814/−113. Engine 668.
No SQL, no function deploy, no new secrets.** Everything below is a hand-merge: jerky localizes almost every
file the range touched.

- **`collectDay` / `collectTime`** — a collected order now records the day and time the customer comes
  (`views/orders.js`: `collectWhenFields`, drawn FIRST on the Edit card so a parked charge's "Send a van"
  heading cannot sit above it). ⚠️ **The ＋ New order card collected them and `addNew` never wrote them** —
  that is the fault class the round trip below exists for.
- **`dayBlock()`** (`courier_job.js`) — the two day lines, localized: `Posting day: <day>` then
  `Delivery: <day>, <window>` or `Collection: <day>, <time>`. ⭐ **The day line strips any trailing window by
  construction**, because a date arrives as a string built elsewhere. ⚠️ **The second line is drawn only when
  it says something new** (a different day, a window, a time) — jerky's own v653 rule, kept.
- **`collectTimeText()`** — her typed time, else the Point's own hours; **the order's `deliveryWindow` is the
  VAN's and is never a collection time** (that is the contradiction v659 found on a real confirmation).
- **`trackingSnapshot`** — the customer's card shows the day she promised and her time, never the van window.
- **Buffer + charge label + final charge** (`courier.js`, `views/settings.js`, `views/courier_quote.js`,
  `views/delivery_run.js`) — `courierBufferOf` / `withBuffer` / `chargeLabelOf` / `chargeIsSettled`;
  `runChargeAmounts(…, buffer)` puts the buffer on the CUSTOMER's charge only.
  ⚠️ **`defaultWindow` ships EMPTY here** (the bakery ships "3-8pm"; munchies posts parcels and must not
  promise a van window).
- **Van-day check** (`health.js`, `views/health.js`) — a courier day earlier than the posting day fails, names
  every order, and one press clears that day. ⚠️ **The check reads EVERY order, not only posted ones** — a
  collected Point order carries a van day and the run uses it. **A passing check states its own count.**
- **`store/build.js`** — `freshenAssets(entries, origin, doFetch)` moved into the leaf module (the bakery's
  shape), so the `cache: "reload"` press is now driven by a test instead of pinned by source text.
- **Test fixes:** `test/health.test.js` counts 25→26 checks / 13→14 local; `confirm`, `messages`,
  `delivery-run` assertions moved to the two-line shape.

### ⭐ THE ROUND TRIP — the systemic guard (`test/order-address-suggest.test.js`)

**Her words to the bakery: *"you expect me to check your work everytime? avoid this systemically"*** — after
three fields she found by hand that a card collected and never saved.

The guard types into **every order-fact box** on the Edit card, presses **Save changes**, reopens it and
asserts every value came back; then does the same through the ＋ New order card (asserting the **order**
carries each value) and the Note / tracking card. ⚠️ **It fails if a box appears that is neither round-tripped
nor explicitly excused**, so a field added next month must answer the question.

⭐ **It found a real fault in this very port before it shipped:** `collectDay`/`collectTime` were drawn and
read back on the Edit card, and nothing put them into `shared` — the fourth instance of the same loss.

**Suite 3998 → 4016.** ⚠️ Also localized two older leaks the sweep turned up: *"Tell the baker's helper this
message"* (an error toast) and *"no bake day"* in the put-back dialog.

⚠️ **And the shop's Malay day word is now `hari pos`** (her instruction the same day) — see the v669 section
above; `test/store-i18n.test.js` now forbids **both** `hari penghantaran` (delivery day) and `membakar`/`bakar`.

## v656 — the shop's Reload press re-asks for the files (27 Oct 2026)

**Her words:** *"it fail to refresh again on browser."* **The build was already pushed and the site was
serving it.**

⚠️⚠️ **A plain `location.reload()` re-asks for the PAGE and takes every other file from the browser's own
copy.** GitHub Pages serves `/store/` with `cache-control: max-age=600`, so for ten minutes the page comes
back new while **`app.css` and every module beside it come back old** — and v655 changed only the
stylesheet, which is exactly the file that stayed behind. **A second press could not help: it does the
same thing.**

- **`store/build.js`** — `assetsToRefresh(entries, origin)`: the page's run of
  `performance.getEntriesByType("resource")`, filtered to **same-origin code, stylesheet and fonts**.
  ⚠️ **The list is the page's own** (a module graph is not knowable from here, and a hand-kept list of
  filenames goes stale on the first file anyone adds). ⭐ **Photographs are left out — a build number never
  names one**, and re-downloading ten product photos would spend a customer's data to fix nothing.
- **`store/app.js`** — the press calls `freshenAssets()` (each file re-fetched with `cache: "reload"`, which
  is the whole fix: **a plain fetch is answered from the cache that is the problem**) and reloads only
  after; **raced with a 2.5 s beat** so a slow connection never leaves a dead button.
- ⚠️ **A page that is already old cannot contain this fix** — its button is the old one. One hard reload
  gets past that, and from then on the strip's own press suffices.

**Driven in the browser:** the press re-asked for **35 files, 0 of them photos**, then reloaded onto the
new page with no console errors. Two guards in `test/store-build-notice.test.js`, one of them pinning
`cache: "reload"` (the mechanism without which the press is a no-op). Suite 4000.

## v653–v655 — the customer's second date, and the card on a phone (27 Oct 2026)

**Her model of the three dates, verbatim:** *"order date = for merchant only; bake date/post date = to let
customer know when is the cooking done; delivery date = if customer choose some date other than the 2nd
date"* — then *"munchies also has collect date if defer from post date."*

- **v653** — the customer's paper (invoice and Wi-Fi label) **names the second day when it exists and
  differs** from the posting day. The parcel label has printed both since v429; it was the customer's paper
  that named only one.
- **v654** — **one field carries "the day it reaches them" both ways**, so the word follows: **`Delivery`**
  on a posted order, **`Collection`** on a collected one. v653's line said "Delivery" for both.
- **v655** — ⚠️ **the product card on a phone**, from her screenshot. **Measured at 412 px: the description
  column had ~90 px** (photo 120 + price/stepper on the same row), so it printed **one word per line** and
  "ONLY 10 LEFT" broke into three. **`store/app.css` gains ≤560 px** (the head wraps; `.card-side` takes its
  own line, photo 88 px — **words 90 → 252 px**) **and ≤400 px** (price and stepper wrap: measured at 320,
  they want 194 px beside a 158 px column). **Verified in the browser at 412 and 320: no card overflows, no
  sideways scroll.**

Suite 3998.

## v652 — the customer's paper shows the posting day, not the order date (27 Oct 2026)

**Her words:** *"for customer side, their concern is post date, not order date, order date is for
merchant."*

**`invoiceSheet`'s `subtitle` was `orderDateOf(first)`** — the placed date, on the sheet that goes in the
parcel and (via `invoice_image.js`) on the Wi-Fi label. **It is the order's posting day now**
(`deliveryDateOf`), and **the placed day stays on her own screen**, in the order's row and card.

**Guard:** `test/invoice.test.js` — the subtitle is the posting day, and "no date" now means **no day of
either kind** (a row with a posting day and no placed date is an ordinary order and prints that day).

## v651 — the lookup had stopped asking Google at all (27 Oct 2026)

**Found by the diagnostic added for v650** (`mode:"verdict"`), and it explains months of *"a list
appeared, not on the door"*.

⚠️⚠️ **v561 moved the Google key from the query string into `X-Goog-Api-Key` to keep it out of Deno's
URL-bearing errors — and the LEGACY Geocoding endpoint does not authenticate by header.** It answered
*"You must use an API key"* to every call; the lookup treats a refusal as "ask the free pair", so **nothing
failed and every lookup since was answered by OpenStreetMap** (roads, no house numbers).

**Fix:** the key goes back in the query for the legacy endpoint, **and the protection moves to where it
belongs** — error text is scrubbed (`key=***`) before logging, and a new test fails if any code in the
function prints or returns a URL. **The type-ahead moves to Places (New)** (`places.googleapis.com/v1`),
which *does* take the header — ported from the bakery's working `courier/suggest.ts`. **The courier's
`geocode.ts` had the identical fault and is fixed too.**

**Proof:** verdict `{"status":"OK"}`, and `23 Jalan Seang Tek` → **`23, Jalan Seang Tek, George Town,
10400 George Town, Pulau Pinang, Malaysia`**.

**Both functions deployed.** Suite 3997. **The shop page still needs the push for the live list.**

## v650 — the address box suggests like Google Maps (26 Oct 2026)

**Her report:** *"the address auto complete like not working well"* → *"i want it to be like google maps
autocomplete"*.

**Cause:** the shop asked **Geocoding** ("where is THIS address") — which needs a near-complete address and,
half-typed, returns the middle of a street. ⚠️ And when Google refuses (spent cap, key not allowed), the
lookup **falls through to the free OpenStreetMap pair — Malaysian roads, no house numbers.** That is *"a
list appeared, not on the door."*

**Build:**
- **Function** (`shop-geocode`): two new modes — `autocomplete` (Places Autocomplete, `components=country:my`)
  and `place` (Place Details → the point). Pure readers `suggestionsFrom()` / `placeFromDetails()`; **the key
  rides in the `X-Goog-Api-Key` header, never the URL** (v561's measured rule — Deno errors embed the URL).
  **A refusal is `null`, never an error**: no key / Places not enabled / spent quota ⇒ the shop falls back
  to yesterday's behaviour.
- **Client** (`store/lookup.js`): a **260 ms glance** beside the 700 ms pause. ⚠️ **The glance is only
  scheduled when it is genuinely quicker** (`quickMs < waitMs`); if it answers, its list is the list and the
  slower question is stood down; if not, nothing changes. **The free pair are still never asked while
  someone types** — their own policy.
- **Pin** (`store/app.js`): a tapped suggestion is **not** a door — `resolveSuggestion()` asks for its point,
  re-checks the box has not moved on, then runs the ordinary `takeHit` path. **The box fills with Google's
  own full address.**

**⚠️ Two steps:** enable **Places API** on the `jienluv2bake-geocode` project **and allow it on the key**
(Geocoding-only today), then redeploy `shop-geocode` from the repo folder. **Until then nothing changes.**

**Guards:** `test/shop-geocode.test.js` (a suggestion carries words and an id, never a point; a refused
Places call is silence) and two in `test/store-address.test.js` (a row asks for its own point before it pins;
Google not serving leaves the old behaviour intact). **The first was watched failing.** Suite 3992 → 3996.

## v649 — every stop on the delivery run names its order (26 Oct 2026)

**Bakery v649, 8 files, +61/−7, no SQL.** Her words: *"the delivery run shown a delivery on 30 sept … no
link up and no order number."* **The run was right:** a day exists there only because an order points at
it (the van day wins over the posting day). **Every doorstep stop now wears its order code `#…` as a link
that opens the order**; a Self collection Point carries several customers so it keeps none. **And the row
wraps** — measured: the name column collapsed to 0 px at phone width. Suite 3991 → 3992.

## v630–v648 — a new face for the shop, and a customer can ask to be told (26 Oct 2026)

**Bakery range `24374b6..5d83c93` (v630–v648), 18 commits, 42 files, +2994/−176.** ⚠️ **ONE SQL STEP:
`supabase/waitlist.sql`** (new table, idempotent). **No Edge Function.**

⚠️ **`store2/` was a bakery experiment and is ABSENT at their HEAD** — added and deleted inside the range
("the trial is now the shop"). Nothing to port; the design landed in `store/`.

### The shop (v631_2 → v640)

- **Photo hero, four-step bar, item rows.** ⚠️ **The hero is a PORTRAIT photo**; jerky's own banner is a
  1264×466 strip, so the hero uses **`images/chicken-jerky.jpg` (1000×1333, 3:4 — the design's own
  shape)**, with a one-line comment for swapping it.
- **A FULL day is a press that answers** — *"…is full. The next day you can have treats is …"* with a
  **Choose** press; **no count on a day that is not yours to count**.
- **"Good to know"** — posting days, cut-off, collecting/delivery, paying, changing an order, WhatsApp,
  **in her own words** (the plan is editable).
- **"Your last order"** — one press to repeat it; **saved on the customer's phone only**, with Forget.
- **Food facts per product** — *What is in it* and *Keeping it*; **blank draws nothing**.
- **The waitlist** — *"tell me when this day frees up"*, a number and an optional name; the freed day
  reaches exactly those people.

### The admin

- **Backups fold into one list** (v644–v645); the box shows the shop's own words (v642).
- **A quiet nudge** (v646–v647): criteria and words are hers; **it may not say discount/offer/sale/free**.
- **A failed Wi-Fi print says what went wrong** (v629).
- **v630:** force update gets the no-worker case (ported from ours).

### Merge notes

20 hunks across 8 files. ⚠️ **The shop was a real hand-merge:** jerky's tap-answer work (`askable`,
`closed`, `missNote`, `dayAsk`) now sits beside theirs' `fullIso`/`fullNote` — the day is a button when
`open || named || askable || closed || (full && !past)`, and **both answers draw, one at a time**.
**A duplicate copy of the v452 step test came in with the merge** — the file's own rule is that test must
run *first*, so one copy was removed and the survivor moved to the top. **Localised:** the hero CTA, the
pack note ("posting day"), the nudge's link (it asserted the bakery's domain), and the step assertion
(jerky has no "way" step — the address is what comes next). **Suite 3937 → 3991.**

## v629 — Force update actually forces it (23 Oct 2026)

**Found on her Mac, 23 Oct:** the strip read *"this phone has v625, the site has v628"*, she pressed **Force
update**, and the same sentence came back.

⚠️ **`forceFresh()` unregistered the service worker before reloading.** **This app's worker is the one layer
that forces every script to be revalidated** (`fetch(req, { cache: "no-cache" })` for code); unregistering it
handed the reload to the **browser's own ten-minute cache**, which GitHub Pages fills — so the same old
modules ran. ⭐ **The unregister cannot fix the HTTP cache; it only removed the layer that does.**

**Fix — two stages:** from an ordinary address, `reg.update()` + clear Cache Storage + reload **through the
worker**; from a page that was already loaded via `?fresh=` and is still behind, unregister + clear + reload
from a new address.

**Guard:** `test/freshness.test.js`'s v614 test **asserted the old behaviour** — it would have kept the fault
alive. Rewritten to pin both stages; **watched failing** on the old code. Suite 3937 → 3938.

## v627–v628 — one document on the label printer: the invoice (23 Oct 2026)

**Bakery v627–v628, 2 commits, 12 files, +324/−152, no SQL.** Her words: *"i dont have to have 2 docs, i
just need one docs, that is the invoice with all info in it."*

- **v628:** the invoice card gains **"Invoice over Wi-Fi"** — it draws the invoice at **100 × 150 mm**
  (business + address, Invoice #, placed date, customer, items and amounts, code/discount, Total, receipt
  and order numbers, COD/refund sentence, printed date) and sends it to the label printer. **The separate
  small receipt is WITHDRAWN** — its button removed, `admin/js/receipt_slip.js` and its test deleted. The
  A4 invoice and its print/PDF route are unchanged.
- **v627** (which the withdrawal superseded): the receipt's two dates were each labelled — the placed date
  and the posting day — because printing one labelled and one bare read as a contradiction.
- **New:** `admin/js/invoice_image.js` + `test/invoice-image.test.js`. **No user-visible bakery wording**;
  the label's business name comes from the published settings.

**Suite 3936 → 3937.**

## v625 — the "can still be found" check can remove its own rows (22 Oct 2026)

**Bakery v625, 8 files, +81/−12, no SQL.** Her words: *"now remove them"* — the named orders were old test
rows. The red line gains **"Remove the N orders with no bake day"**: it **asks first and names every
code**, then uses **the same shelf as the row's ✕** (Removed list, 30 days, reversible). **It removes only
what the check names** — no bake day and no day of its own — so a placed order is untouched. The per-card
remove from v624 stays for a sale she would rather put on a day. **Localised:** "bake day" → "delivery
date" in both strings. Suite 3934 → 3936.

## v610–v624 — Wi-Fi label printing, the ghosts stopped, and a card that can remove (22 Oct 2026)

**Bakery range `c08a081..b3ab928` (v610–v624), 14 commits, 37 files, +2048/−58.** ⚠️ **ONE SQL STEP:
`supabase/print_jobs.sql`** (new table, idempotent, nothing existing touched). **No Edge Function, no CSS.**

### Wi-Fi label printing (v610, v612, v617–v623)

A phone cannot open a raw socket to a printer, so the label goes **phone → `print_jobs` (Supabase) → a
bridge on her Mac → the printer over TCP/TSPL**. New:

- **`print-bridge/`** — `bridge.mjs`, `retry.mjs`, `status.mjs`, `tspl.mjs`, an installer/uninstaller and a
  README. **LOCALIZED on the way in:** `com.munchies.printbridge`, `~/.munchies-print.json`,
  `~/Library/Logs/munchies-print.log`, and the install folder (`~/Downloads/jerky`) — the bakery's own
  label and paths would have collided if both bridges ever ran on one Mac.
- **`admin/js/print_site.js`** — the device's own printer name (Settings → *Label printer name for this
  device*), **device-local on purpose**: two sites, one book, and each bridge prints only its site's jobs.
- **`admin/js/label_image.js`, `label_pdf.js`, `receipt_slip.js`** — the label as an image (so a printer
  app on a phone can take it), a long label on one sticker, and a small customer receipt.

### The ghosts (v616) — a semantic change to a rule we fixed

⚠️ **`dropStaleShelfRows` no longer always prefers the live order.** Her words: *"the old data keep
comming back like ghost."* **An old copy could erase a deletion and the resurrection travelled up.** The
two dates decide now: **a removal newer than the copy wins** (the live row is taken off and its deletion
sent up again); a deliberate **`restoredAt`** wins the other way; **a copy with no date falls back to the
old rule** rather than guess. It returns `dropped + revived`, so a revival still queues its tombstone.

### The rest

- **v613/v615:** the check's `carried` line gains a **repair press** (`f.repair = "receiptStamps"`) that
  claims every missing number at once. ⚠️ **Their way-out text had regressed** to "press Paid again",
  which cannot work on a paid order — **jerky kept its v601 wording (Invoice).**
- **v614:** force update when closing the app does not update it.
- **v624:** **an order with no bake day can be removed from its own card** — it had no row, so the ✕ was
  unreachable. Asks first; goes to the Removed list.

**Conflicts: 9 real hunks** (`changelog.pdf`'s 255 skipped as binary + `CHANGELOG.md` kept as ours).
**Localised:** `settings.js` "your bakery's name" → "your business's name"; the bridge's identity (above).
**Suite 3896 → 3934.**

## v606–v609 — sell on any day, and the day it makes is private (20 Oct 2026)

**Bakery range `a0186d0..c08a081` (v600–v609), 7 commits, 19 files, +691/−51. No SQL, no functions, no CSS.**
⚠️ **v601–v604 in the bakery are jerky's own fixes ported back** (Edit card whole sale, receipt number
survives the merge, check names the right press, the refund line) — so the two apps are level again.

**What is new:**
- **v605 → v607:** a "Sell one now" press on the day card, then **removed** — the ＋ New order card is
  already on every bake day and makes the identical sale. It survives only on a day with no card at all.
- **v606:** **a hand sale on any day.** A day the shop does not offer answers a tap with **"sell now"**,
  which records the sale on the day it happened and opens the order card there. The day it creates is
  **`recordOnly`** — a SALE-ONLY day: in her backoffice, orders and books, **never on the shop**.
- **v608:** **a private sale's day is not announced anywhere** — not the Orders calendar, the Delivery
  Dates screen, Home's upcoming deliveries or the purchase order, and it no longer labels itself. ⭐
  `bakeDays(state)` is the one filter every bake-day surface asks.
- **v609:** a non-bake day reads as **two freedoms first** — say what you baked, or sell now; neither is
  official and nothing is announced — **with More → Delivery Dates as the optional third.**

**Merge notes.** 20 conflict hunks across 9 files; **most were our own fixes coming back** (theirs renamed
`sameValue` → `sameLineFact`, split `equalised` from `dropped` in both sync seams). ⭐ **The merge produced a
duplicate `equaliseOrderLines` declaration in `state.js` and a duplicate call in `mergeRows`** — both caught
by the parse/suite step, not by a conflict. **Localised:** the `cal-miss` sentence now reads
*"…is not a delivery date … or add it in More → Delivery Dates"* (theirs said "bake day" / "More → Bake
days"), and one check's way-out said "bake day" too. **A stale test fixture fixed:** `test/stock.test.js`
pinned 19/20 Oct literally, so on the 20th the "real day" fell out of the published list — the dates are
relative now.

**Suite 3882 → 3896.**

## v605 — the check watches refunds too (19 Oct 2026)

**Second sweep finding, shipped on its own.** A refund is stamped on the order (`refundedAt`,
`refundAmountRM`) and **subject to the same whole-record wipe as the receipt number** — a newer copy from a
phone that never learned the refund removes it, and Money/Profit then read the money as still held. **The
register survives that wipe, and nothing on Check my system was watching.**

**New check:** `refundChecks`-side, id `refunded` — *"Every refund in your register is marked on its
order"*. It reads the **register**, not the order, which is what makes it honest: `unrefund_receipt` clears
`refunded_at` in the register, so **an undone refund can never be reported as a fault**. An order this
phone does not hold is left to `hasOrder` (the line above). Way out = **Invoice**, which copies the refund
and its amount back from the register (the same second chance as the number).

**Guards:** two tests in `test/health.test.js` — the fault is named once with its code, an order carrying
its mark passes, a register row with no refund passes, and a receipt for an order this phone lacks is not
blamed here. **Watched failing** (the check forced to pass) before it was kept. Check count 24 → 25;
`registerChecks` 2 → 3. Suite **3882**.

### Deploy order — SQL first, then the functions, then the push

1. `supabase/tracking.sql` — **required before the build**: the shop now sends a phone and the old
   function has no second parameter. This file drops both signatures and recreates the two-argument one.
2. `supabase/receipts.sql` — `bill_rm`, and `claim_receipt_number` / `refund_receipt` are dropped and
   recreated (a changed signature cannot be `create or replace`d).
3. `supabase/shared_pool_slots.sql` — the slot counts count a pack's pieces once. **`instant_slots.sql`
   is RETIRED: it raises "This file is retired … nothing has been changed" by design, because running
   it would revert the pool version already installed. Do not run it.**
4. `supabase/advisor_fixes.sql` — the revokes (a new file; idempotent).
5. Redeploy all five functions from the repo folder:
   `supabase functions deploy <courier|parcel|shop-geocode|shop-feedback|wish-mail> --project-ref
   ircwozniiyywsowamixy`. **`shop-feedback` gains `limit.ts`**, which the CLI uploads only because
   `index.ts` reaches it.

**Jerky-only resolutions kept:** `TREAT_COUNT` and its seed; the postage settings (`postageRM`,
`postageSet`, `postageMode`, `postageModeSet`) kept alongside the new `homeProductId`; `bookedUnitsOnDate`
kept as the date-string entry point and now **counting a pack's pieces and honouring the off-sale/hidden
rule** — `totalUnitsOnDate` and `poolRemaining` both widen an id back to its DATE (two calendar records
can share one day, jerky's own fix); the shop's `apply("courier")`, "Post (nationwide)" / "Collect (local)",
`clockWords`, `dayAsk`/`postsOn`/`missNote`/`calMiss`/`calClose`; `buildMessage`'s point and pin lines.
**Localized:** `trackNotFound` (phone), `buildWarnBody`, `noMenu`, `confirmAddWaShape`, `trkItems` /
`itemsTotal` / `trkTotal`, the receipt's "your receipt register" with the operating instruction dropped.

## v541 → v549 — the full detail audit, twenty-two faults fixed (18 Oct 2026)

**Eight bakery versions (v542–v549). 35 files; no SQL, no Edge Function, no CSS.** Suite **3536 → 3574**.

**Her words:** *"since there is so many error, why not you do a thorough audit on all small details then
draft a plan to rectify it one off."* Every screen, calculation and save/load path was read end to end.
⚠️ **The finding worth keeping: all 3,525 tests were green while all sixteen of the first batch were
live** — every one was found by reading the producer and measuring the number, not by a test going red.

**The wrong-number faults (v544–v549).** A recipe line's cost applied the ingredient's own unit factor to
a quantity written in the line's unit (RM2,500 for a RM2.50 item, Profit's cost of sales ×1000 out);
quantities in different units were summed as raw numbers (500 g + 1 kg = 501); correcting one product's
bake gave back another product's ingredient; a correction the shelf could not cover invented stock (it is
now **refused**); the amend popup's "amount to buy" named the wrong unit; **a blank in the saved
`deliveryDays` pattern was printed as Sunday** (`Number(null) IS 0` — the third appearance of that
coercion); and **a discount larger than the bill printed lines that did not add up to their Total**
(`promoCut`/`couponCut` are now capped at the gross, so every printed surface agrees with itself).

**Two phones.** A removed unit was remembered only on the phone that removed it, so `uoms` (which **is**
cloud-synced — the old comment said "per device" and was stale) re-seeded it there and pushed it back:
**`uomsRemoved` is now a registered list**, its own records travelling. A product's bake day became
**one record per product** (`bakeId`), because one row per day let two phones overwrite each other — an
old one-row day is split on load, moving no stock. A change made during a sync is no longer swallowed.

**The shop (v548–v549), seven faults.** A product renamed or removed left the basket stuck — `lines` came
out empty while step ② still read done, and the press did nothing with no message; the basket now empties
and says which item went (`fixGone`, `confirmChangedTitle`). A repaint mid-send re-enabled Place order, so
a slow network could post the same order twice — the send state is now a `var` that survives repaints. A
courier order could be posted with `address: ""`; **the address box now marks itself** (jerky's own
`confirmAddrTitle`/`confirmAddrBody` wording, `markField` rather than the old foot-of-page banner), and
**a dropped pin counts as an address**. `todayStillOpen` replaces `isOpen(cfg, today)` for the heading,
whose deadline is *yesterday* — so "closed" showed on every day of the year. A refused promo was judged
once and reprinted frozen ("add RM14 more" stayed after the RM14 was added); it is re-judged on every
repaint. `renderMenu()` now runs with the basket reset.

**Jerky-only decisions kept.** The postal-address gate stays; it is now marked on the box like the name and
number boxes, and the pin counts. The two bakery-only `confirmAddAddr*` keys were not taken. The
`confirmAddWaBody` Malay wording is jerky's ("tempahan"), not the bakery's ("order"). The `store/` guardrails
(🐾, "Post (nationwide)", `apply("courier")`, `dayAsk`/`postsOn`/`missNote`/`calMiss`/`calClose`) all survive.

**Two new guards taken:** `test/ingredient-audit.test.js` (nine tests against the real modules) and
`test/weekday-names.test.js` (a blank is not Sunday; `normalize` cleans `deliveryDays`). **Not taken:**
`AUDIT-2026-10-18.md` (the bakery's own report, addressed to that business) — its content is in this
entry, `CHANGELOG.md` and the Guide instead.

**Engine 549**, because from 17 Oct 2026 this app takes the bakery's number on each sync.

## v536a → v541 — a product with no ingredients can still be recorded (17 Oct 2026)

**One bakery version (v541). 2 files; no SQL.** Suite **3535 → 3536**.

**Her words:** *"why a hidden product dont appear on total baked?"* — then *"i dont see them because there
is no ingredient with them."*

⚠️ **It was not a bug; it was a GATE.** The baked box listed **only products with a recipe**, because a box
for a product with no ingredients moves nothing — and *"a control that does nothing is a bug in this app."*
⭐ **But the cost was worse than the rule: she had made something and the app would not let her record it,
because a recipe was not set up.** **Her own rule is "guide, never a gate" — and this was a gate.**

**Now every product is listed**, and one with no ingredients carries on its own row: **"no ingredients on
its recipe — this will not change your stock."** ⚠️ **Both rules survive** — the day is complete, the note
means it is not a control that quietly does nothing, and **the day she adds the ingredients the same box
starts moving stock with nothing else to learn.**

⚠️ **Checked rather than assumed:** `applyBake` was already safe with an empty recipe — it iterates no
ingredients and changes nothing.

⚠️ **The test asserts the note PER ROW**, because a page-wide match would pass with the warning beside the
wrong product — and both the recipe-only filter and a note on the wrong row were watched failing.

## v535 → v536 — a save that fails says so, and a restore no longer hides records (17 Oct 2026)

**Six bakery versions (v534–v539), 14 files merged, plus `robots.txt` and `test/publishing.test.js` new.**
Suite **3515 → 3535**. **8 conflicts**, all mine against the bakery's refined version of the same feature —
**resolved to theirs**, which converges the two repos.

### ⚠️ v535 — a save that fails was silent

**Her question:** *"is there a test that you should run to detect this systemic problem, or any risky system
handling that we should eliminate before the database build up?"* — and it found one. `save()` caught a
full-phone `QuotaExceededError`, wrote it to a console she will never see, **and carried on**. ⚠️ **"It
saved" and "this phone is full" were both true at once**, and the save hook still ran — so the change was
queued as though it had been kept. **It reports now, and the page shows how full the phone is.** *A growth
fault, which is why a year of use never showed it.*

### ⚠️⚠️ v539 — a real bug in OUR OWN new sync, found the same day

**Her question:** *"any other problem that can happen?"*. ⚠️ **Incremental sync needs a bookmark; `rewindTo`
and Import both replace the whole book and the bookmark was not reset** — so after either, the data jumps
backwards while the cursor still points forward, **and every record older than it is never read again.**
Both presses now call `forgetReadCursor()` — **`lastSeq` and `lastCount` only, never the sending queue**,
because that queue is exactly the unsent changes this app protects. **Made to clear the queue, the test
goes red.** And **Import is no longer a one-way door**: it saves a "Before import" copy.

### v538 — search engines

⚠️ **The backoffice is PIN-locked, but its title and existence were public the moment Google crawled it.**
`admin/index.html` now carries **`noindex, nofollow`**; the homepage and `store/` carry **`index, follow`**
in their own words; and a new **`robots.txt`** disallows **`/test/`** — her working papers, which the site
publishes. ⚠️ **Deliberately not both on the same thing:** a crawler refused the page can never read its
`noindex` tag.

### v536 — her wording

Her sixteen translation decisions pinned against the live file; **`confirmAddNameBody`** (Malay) had a verb
hanging and dropped "with you", and **a fifth "Pemandu"** had survived her *driver* decision. ⭐ **A rule
recorded as a list of strings stops at the end of the list.**

### ⚠️ Two deliberate non-ports

- **`test/store-vocab.test.js`** — the bakery's new file pins **its** shop's words (*"a bakery is a BAKERI"*,
  *"a bake day is `hari membakar`"*, the bread line). **Jerky's shop is a pet-treats shop with none of
  them** — it says *posting day* / *hari pos*. Dropped, like `store-track-money.test.js` before it.
- **v541's PDF-Chinese fix** — it lives in the bakery's **gitignored `marketing/`**, so no merge can carry
  it. Jerky's documents are English on purpose; **noted, not ported.**

### ⚠️ And one jerky-only string the merge broke and I fixed

`store-lang.js`'s Malay **`confirmAddrTitle`/`confirmAddrBody`** — **jerky-only** (its postal-address gate;
the bakery has no such keys) — were **dropped from the Malay block** when theirs replaced that section.
Restored verbatim from HEAD. ⚠️ **A key that exists in two languages and not the third is invisible until
`store-i18n`'s key-set test catches it — and that is exactly what caught it.**

## v534 → v535 — the database step was EMPTY, and a guard now stops that (17 Oct 2026)

**2 files: the real `supabase/sync_cursor.sql` (0 → 4,758 bytes) and a new `test/sql-steps.test.js`.**
Suite **3513 → 3515**. ⚠️ **SHE MUST RE-RUN THE SQL** — the one she pasted was empty.

### The incident

⚠️⚠️ **v533's changelog said "RUN `supabase/sync_cursor.sql` BEFORE YOU DEPLOY THIS" — and the file was
0 bytes.** She ran it; it did nothing. ⭐ **Nothing said so, because the fallback worked: with `seq`
missing the pull does the full, paged read — slower, never wrong.** And **I then told her the step was
confirmed**, having checked that the file *existed* and was *in the commit*, **not that it had anything in
it.**

⭐ **"A promised step that is empty looks exactly like a step that worked, and a graceful fallback is what
makes the difference invisible."** The bakery found this in our repo's history — it wrote the guard
first, and this is their catch, not ours.

### The fix

- **`supabase/sync_cursor.sql` replaced with the bakery's version**, which is better than what was meant
  to be there: an explicit `grant usage … to authenticated` instead of `SECURITY DEFINER`, a column
  default as well as the trigger, `set not null` (so a gap fails **loudly**), an undo block, and — ⭐
  **a read-back of four numbers at the end (`rows`, `stamped`, `lowest`, `highest`) so she can see it
  worked instead of being told it did.**
- ⭐ **`test/sql-steps.test.js`** — two tests. One sweeps **every `.sql` in `supabase/`** and fails if any
  is empty or comments-only; the other pins `sync_cursor.sql`'s own promises (the `seq` column, a stamp
  **on UPDATE as well as insert** — *a default fires on insert only, so an edited row would sit behind
  the cursor for ever* — the sequence grant, and idempotency).
- **Bitten:** emptying the SQL file fails **both** tests by name.

## v533 → v534 — the 30-day change is upstreamed, in the bakery's better shape (17 Oct 2026)

**5 files changed; no SQL** (the cursor script she already ran stands). Suite **3512 → 3513**.

⚠️ **jerky's own v530 (the 30-day Removed list) was a MUNCHIES-ONLY fix. The bakery has since made the same
change properly — its v530 — and this replaces mine with theirs.** Her decision is unchanged; **what
changes is where the number lives.**

### Why theirs is better

⭐ **`removedKeepWords()` in `admin/js/state.js` — the number spelled ONCE, and every consumer asks for
it** (`health.js` ×2, `views/orders.js` ×1). ⚠️ **My version typed "30 days" into each screen, and a
number written into a sentence is a second copy of a decision.** That is not theoretical here: the comment
above `pruneRemovedOrders` said *"thirty days is long enough"* while the constant said 48, **and that
disagreement was quoted back to her as evidence before the constant was read.**

⭐ **And the bakery named a distinction I missed: ONE SETTING WAS DOING TWO JOBS** — how long a removed
order stays **puttable back** (what she answered) and how long a removal **leaves a trace** for the check
that opens a ~week-old copy. 48 hours could never satisfy the second.

### The guard, rewritten

⚠️ **The first guard only checked that the screens CALLED the helper — and it passed while a hard-coded
"30 days" sat in one of them.** *"A check keyed to one occurrence checks one occurrence."* It now strips
comments and asserts **no consumer spells a window at all**, and it was watched failing.

### What this removes

⚠️ **42 jerky-only lines from my own version are gone — deliberately.** Every one is my hand-typed window
being superseded by the helper. **The divergence is closed**, which is the point: a jerky-only fix that
upstreams should not leave two copies behind.

### ⚠️ The engine numbers have parted company

**Munchies reads v534; the bakery reads v530.** Munchies took four jerky-only versions (the Removed list,
Put back missing orders, the record count, and the paged + incremental sync) while the bakery stood still.
**The number is each app's own build stamp, so this is not a fault — but they will not match by accident
again.** Recorded so the next session does not treat it as a sync that half-worked.

## v532 → v533 — incremental sync: read only what changed (17 Oct 2026, **jerky-only**)

**6 files changed, plus one NEW SQL script. Suite 3509 → 3512.** ⚠️ **RUN `supabase/sync_cursor.sql` BEFORE
DEPLOYING** — a push runs no SQL. It is idempotent.

### Why a database step, and why a counter rather than a timestamp

⚠️ **The obvious cursor is "everything after 10:23" — and that trusts each phone's clock.** Two phones are
two clocks. **A phone running behind writes its edits with a time in the past, where a cursor would never
look again.** ⭐ **With a full pull that costs speed; once the pull is incremental, a missed row is missed
FOR EVER.** ⚠️ And `updated_at` is a **text** column holding two different shapes (`…T10:23:45.123Z` from
the app, `… 10:23:45.123456+00` from `now()`), which do not compare lexicographically as times at all.

⭐ **So the cursor is a `bigint` sequence the server stamps in a `BEFORE INSERT OR UPDATE` trigger** — every
write takes a number strictly higher than every number before it, whoever wrote it, whenever. **No clock can
decide what "since" means.** ⚠️ The function is `SECURITY DEFINER` on purpose: the app writes as
`authenticated`, which has no privilege on the sequence.

### The client

- `sync.pull` reads the journal's `lastSeq`. **Null means a full, paged read** (first run, or after a
  fallback). Otherwise it asks `seq=gt.<lastSeq>` and pages **ordered by `seq`**.
- ⚠️ **The cursor advances ONLY on a complete read.** A half-read book must not be remembered as seen.
- ⚠️ **A write during the scan always takes a higher number than anything already read**, so it cannot slip
  behind the cursor — the next beat asks for it by name.
- ⚠️ **If the SQL has not been run**, `seq` does not exist, PostgREST answers **400**, and the pull
  **falls back to the full paged read** — slower, never wrong — and sets `seqUnsupported` so it stops
  asking. **That fallback is why this can be pushed even if the pasta is forgotten; it is deliberately not
  silent-and-broken, just silent-and-slower.**

**Bitten, all three:** forcing a full read every time, advancing the cursor on a partial read, and removing
the 400 fallback each fail a named test.

## v531 → v532 — the sync no longer stops at a thousand records (17 Oct 2026, **jerky-only**)

**5 files changed; no SQL, nothing to deploy.** Suite **3506 → 3509**.

### The fault

⚠️ **`sync.refresh` pulled the whole shared data in ONE request with `limit=1000` — a CAP, not a page
size.** Past a thousand rows a phone **saw an arbitrary thousand and silently never saw the rest**. ⚠️ **And
the read carried no `order=` until this version, so WHICH thousand could differ between pulls.** A record
that shows on one device and not the other, with nothing saying why — that is what "the sync is going in
circles" looks like.

⚠️ **An order is one record per ITEM**, and nothing prunes orders, so a working business reaches a thousand
in months. **Nothing was ever deleted** — the merge only applies rows that arrive — **but records that
never arrived were never seen.**

### The fix

⭐ **`readAllRows()` — one paged reader, used by all three full scans** (the pull, `cloudKeys`, and the
count). It asks for a page, and **keeps asking until a page comes back short.** `PULL_PAGE = 1000` is now
a **page size**; the loop is bounded by `PULL_MAX_PAGES = 100`, so **`PULL_CEILING = 100,000`** is the real
limit — **exported, so the count check and the loop cannot disagree about where it is.**

⚠️ **`order=kind,id` is required, not cosmetic:** without a stable order, `offset` paging can repeat a row
on one page and skip another between pages.

⚠️ **The hard stop reports itself**: `complete: false` reaches `cloudRowCount` as `atLeast`, and
`recordCountCheck` fails **only** at `PULL_CEILING` — the one remaining place a record could fail to
arrive. Its sentence imports that number rather than retyping it.

### The count she asked for

Still on Check my system, now **information rather than a warning**:

> *"Your shared data holds 412 records — and every one of them reaches every phone, because the sync now
> reads them a page at a time instead of stopping at a thousand."*

### ⚠️ The test that would have caught the original fault

`test/sync.test.js` — **"the pull reads EVERY page — a book larger than one page arrives whole"**: a
2,500-row book, paged by a shim, must arrive **whole** with offsets `[0, 1000, 2000]`. **Biting it with the
old one-page return fails it by name**, and so does the count's hard-stop test.

⚠️ **What is honestly next:** each full read is now several requests when the book is large, every 30
seconds. **The real cure is reading only what CHANGED** — `lastPullAt` is already stored and never used —
**and that needs the server to stamp `updated_at` first**, because today it is the phone's clock. That is
its own job, with one SQL script.

## v530 → v531 — "Put back missing orders": an additive repair beside the rewind (17 Oct 2026, **jerky-only**)

**6 files changed (`+305 / −62`); no SQL, nothing to deploy.** Suite **3503 → 3506**.

### The fault

⚠️ **`mergeRestore()` was named a merge and never merged anything** — it replaces the whole state with the
copy, carrying over only the three per-device settings. ⚠️ **The Restore button's own dialog was always
honest** (*"Everything added after it is removed from this phone AND your shared cloud…"*), so the rewind
was not hidden — **but the check recommended it as the answer to "why are these orders missing?", and that
is a week-long rewind offered as a diagnostic.** And there was **no safe way to bring back one order**.

### The fix, in three parts

**1. `rewindTo`** — the function now says what it does. *(Internal name only; behaviour unchanged, and its
warning unchanged.)*

**2. `unaccountedOrders(state, snap)` — ONE rule, TWO callers.** ⚠️ **The check that names the orders and
the press that puts them back must agree about WHICH orders are missing**, and two copies of a comparison is
how the two come to disagree about the same seven. It is exported from `backups.js`, `health.js` imports it,
and it answers: an order is accounted for when it is on this phone, on the Removed list, **on the copy's own
Removed list**, or **covered by a receipt she marked void** (matched both by code and by receipt number).
⚠️ **It returns one entry per ORDER, grouped** — an order is several rows sharing one code, and putting back
one row would put back half an order.

**3. `putBackOrders(state, row, {dryRun})`** — **adds only**, and never removes, rewrites, or touches
anything but `orders`. ⚠️ **It refreshes the sync baseline first and takes a "Before put-back" copy**, the
same discipline a rewind has; and it **recomputes after the refresh**, so an order that has just come down
from the other phone is not added as a second copy of itself. ⚠️ **A `dryRun` changes nothing at all** — the
screen asks it first, so the confirmation names the number it will add rather than a button that says
nothing until pressed.

**Wiring:** the check's `fix` text now points at the new press and says leaving them alone costs nothing;
`Backup and safety` gains **Put back missing orders** between Restore and Download.

⚠️ **THE TEST THAT MATTERS MOST, and the first version of it did not:** an order **added after the copy**
must survive. **The first test passed with a rewind put in place** — it only checked the count — which is
exactly the "assertion that passes whatever happened" fault this repo keeps recording. It now carries a
live-only order and asserts it is still there; **biting it with `state.orders = []` fails by name.**

## v529 → v530 — the Removed list remembers 30 days (17 Oct 2026, **jerky-only**)

**One constant, raised at her asking: `REMOVED_KEEP_HOURS` 48 → 720.** ⚠️ **It is worth recording where 48
came from, because it was HERS:** she set it at v452 — *"the deleted order just need to keep for 48hrs"* —
after thirty days had been the developer's guess. **So this changes her own decision, and the test that
pins it now pins the new one with her new reason beside it** (`test/order-removal-guard.test.js`).

**Why.** `Check my system` opens the **oldest saved daily copy** (`oldestDaily(copies)`, ~7 days back) and
asks whether every order in it can be accounted for — on this phone, on the Removed list, on the copy's own
Removed list, or covered by a receipt she marked void. ⚠️ **A 48-hour shelf cannot explain a five-day-old
removal**, so it named **seven of her own cancellations** as orders that had "left without a trace" — and
its only offered remedy was a full restore. **30 days covers the oldest daily copy with room to spare.**

⚠️ **It cannot bring back rows already pruned** under the old rule — those stay gone, so a removal made
before this change may still be named until the oldest copy rolls past it.

⚠️ **And the stale comment is fixed too:** `pruneRemovedOrders` carried *"Thirty days is long enough…"*
while the setting was her two days — **a note that disagreed with the code and got quoted as evidence.**
(It was quoted in this session, by me, before the constant was read.)

**Engine bumped to 530 on purpose:** a change that does not move `ENGINE_VERSION` never reaches her phone —
`freshness.js` keys the "update now" strip on it. ⚠️ **The two apps now read 529 (bakery) and 530
(munchies) until the bakery catches up; the merge is per-file, so that is cosmetic.**

**Copy updated with it:** both `health.js` messages that named "48 hours" (now 30 days, and the second
names the *old* two-day rule as the reason a pruned row never comes back), the Removed card's *"Kept for
30 days…"*, the Guide's two references, and `test/health.test.js`'s assertion. **Suite 3503 pass / 0 fail.**

## Engine v526 → v529 — a refused batch no longer freezes the queue, and the Removed list holds one row (17 Oct 2026)

Three versions from the bakery. **9 files changed (`+529 / −47`); no SQL and nothing to deploy** — the same
push carries it. Suite **3493 → 3503 pass / 0 fail**. **Zero merge conflicts.**

### ★★ v528 — the worst fault this app has had

Her reports, in the order they arrived: *"yes, look into the stuck records"*, *"the phone and mac having
different error"*, *"more and more removed order shown on phone"*, *"suddenly the phone deleted order goes
to 25"*, *"both grow to 27"*. ⚠️ **The queue could only GROW:** every change went into a sending queue, the
server refused the batch, and **a refusal sends NOTHING — so every change beside the refused one was frozen
with it** — and `flush` only clears what it actually sent. **Pressing Sync now could never empty it, however
many times she pressed. Measured: 3 → 8 → 25 → 27, on BOTH devices, because each holds its own queue.**

**The fix: a refused batch now DEGRADES.** Each record is re-offered on its own, so the good ones go up
immediately and the one the server will not take **stands alone, named**, instead of holding everything else
hostage. ⚠️ **Offline is NOT a refusal** — the batch is not taken apart record by record when the connection
is simply down. ⚠️ **And the ordinary case costs nothing:** single sends only happen after a batch has
already been refused.

**And it now keeps the reason, which it never could.** `refresh` returned the reason to whichever button
pressed it and forgot it — so the card showed "Sync failed" only while she was reading it and **every other
screen was blind.** `lastFailure()` holds `{at, reason, phase, key}`, cleared by the next clean attempt, and
the System check prints **the server's own words and the record it refused**.

⚠️ **Each stuck change is named as the THING ITSELF** — an order by the number she searches, a unit by the
name she typed — where it said *"a removed order"* and *"uoms"*: **a KIND, not a record, which is a name she
cannot look up.** A record with no id says *"with no number"* rather than having one minted out of the string
`undefined`.

### ★ v529 — one order, one shelf row, always

Her report: *"there is so many duplicate order number in the Removed Orders"*. ⚠️ **A loop, not an
accident:** the shelf simply `unshift`ed a new row every time an order came off, **and the shared data hands
an order back whenever its removal has not landed** — which is exactly what the frozen queue was causing —
so she took it off again and a SECOND row with the same number went on. **That is why the same number kept
appearing and why the list only grew.** `removeOrders` now **replaces** the row for that id.

⚠️ **And the duplicate rows already in her data are collapsed when the app opens** — without that the fix
above would tidy nothing, **the same reason the v518 void repair had to exist.** The newest row is kept,
because `removedAt` is what the 48 hours for putting an order back are counted from. **Measured: the same
order taken off twice leaves 1 row, not 2; a phone holding three rows for two orders opens holding 2.**
**Nothing of hers is lost or rewritten: the same orders are on the shelf, just once each.**

### ★ v527 — the check stops blaming her for her own removal

The check named `#4B00A9` as an order that left *"by no route it knows"* — and the app held **two** records
of its fate: **she removed it on her other phone on 11 Oct at 10:47 pm, then marked its receipt (#000015)
void.**

⚠️ **Why it looked like a loss:** the copy the check opens is dated **11 Oct 00:37 — written before that
removal** — so it still holds the order, **and the Removed list keeps a row for only 48 hours, so the row
that explained it had already been pruned by the time she looked.** **A receipt marked void now explains its
order** — the rule the receipt check has had since v448, in almost the same words (*"a recorded decision is
not an unexplained hole"*), **which this check was standing next to without using** — matched both by the
code the void record names and by the receipt number the order carries (a record made before v441 holds the
code the order wore at the time). **And the message names both innocent cases rather than one.**

⚠️ **And it cannot hide a real loss:** a void record for a different receipt excuses nothing, and there is a
test for exactly that — **a carve-out that explained everything would turn this check green for ever, which
is the failure it exists to catch.**

⚠️ **Localization: ONE new user-visible string.** The System check's record-kind map said
`deliveryDates: "a bake day"`; jerky says **"a delivery date"**. **No test pinned it**, and the suite was
re-run after the edit (this project's own new rule: after a localization edit, re-run the suite).

## Engine v513 → v526 — the baking box, and two sync faults (17 Oct 2026)

Thirteen versions from the bakery. **17 files changed (`+1,208 / −175`); no SQL and nothing to deploy** —
the same push carries it. Suite **3482 → 3493 pass / 0 fail**. **Six conflicts across three files**, every
one the bakery's own word (*"bake day"* / *"Bake days"*) against jerky's (*"delivery day"* / *"Delivery
Dates"*).

### ★ v514–v515, v521–v525 — the baking box

Her correction at v515 is that version's whole point: *"set availability and to mention how many to bake is
totally different functionality, why you take way set availability?"* — **v514 merged the day's capacity
and the day's baking under one renamed button, which took away the control she actually uses.** The two
doors are back, each with its own name and its own pop-up: **Set day's availability** (restored verbatim
from v513) and **Baked — how many?** (`openBakedPopup`, a self-contained function). It works on **any** day
— including one that is not a posting day and one already gone — and **writes no delivery date at all**, so
the shop never starts offering a day she opened for nobody.

**The box opens by HER rule, and it took four passes (v517 → v521 → v524 → v525):** a recorded total wins;
a day already gone opens ready at what was ordered; today and every day ahead open empty. ⚠️ **The reason
is the v517 danger:** a number in the box reads as a fact already written down, **so she does not press
Save — and then nothing comes off the shelf, silently.** Her words: *"if i open the total baked and it shows
a number, that mean there is some bake already done that day."* **A number in the box is a statement that a
bake happened, and it may only ever show a number that is true.**

⚠️ **v522–v523: the box is labelled `TOTAL BAKED` because the words had failed.** She asked whether typing
15 after 10 meant fifteen in all or five more — **and that is ten items out**, measured both ways: the app
read "five in all" and **put five BACK on the shelf** (2,500 g → 3,750 g). ⚠️ **And the explanatory line the
bakery added under the box, she deleted in one sentence** — she asked what the sentence meant, which is the
answer to it. ⚠️ **The pattern the bakery names and it is worth keeping: it reaches for a sentence when the
LABEL is the thing to get right.** (v517 was the same shape on the same control.)

### ★★ v516 — ingredients come off when you bake, and nowhere else

Her rule: *"only take away ingredient when baked. And the order dont take away ingredient, then it can be
clean cut."* ⚠️ **Measured with her own numbers: two things took flour off — an order marked Baked AND the
day's baked total — so a sale made after the bake was subtracted twice.** Bake 10 (5,000 g → 2,500 g), then
a 4-item order marked Baked (→ 1,500 g): **she baked ten and the shelf gave up flour for fourteen.**
**`consumeOrder`, `addBackOrder` and `adjustForStatus` are DELETED, not left lying about** — *"a function
left lying about is a function the next person calls"* — and the tests assert they are gone. ⚠️ **The cost,
named: a day she does not record takes nothing off**, which is exactly what makes the past-day pre-fill
worth having. **Nothing of hers was rewritten:** the journal rows those old Baked marks wrote are still
there, and this changes what happens *next*, never what happened before. `Baked` still moves the ORDER along
its journey; only the stock movement is gone.

### ★ v518–v520 — the sync repairs

⚠️ **Her words: *"the sync is a big issue, and my user lost confident."*** Three faults, one shape:

- **v518: a receipt marked void on the Mac was written with NO ID** — and a record that cannot be keyed
  cannot travel (the queue is sent as ONE request and an un-keyable row is dropped from it). The phone never
  learned, so it kept showing the same error and telling her to press a button she had already pressed.
  ⚠️ **And it hid: pressing "Sync now" made the Mac's count go away, because the record was DROPPED, not
  sent — and a count going down looks exactly like success.** Ids are derived from the receipt number
  (`void_15`), and an already-void receipt is repaired when the app opens.
- **v519: the repair moved to the DOOR** — `repairRecordIds(state)` runs at the top of `markDirty`, so
  before anything is queued **every record in every list** gets an id if it has none, **derived from its own
  content with the keys sorted** (so two phones holding the same record work out the SAME id and make one
  row). A list that does not exist yet is repaired by the same line that repaired this one.
  ⚠️ **Honest cost: editing a record that had no id gives it a DIFFERENT id, so the older row stays in the
  shared data — the safe direction, because a stray row can be named and seen and a dropped record cannot.**
- **v520: the screen jumped to the top on a sync repaint.** Her words: *"at after a while it rerender and
  the screen jump up."* ⚠️ **It is not a jump, it is a LOSS** — `viewEl.replaceChildren()` empties the view
  for an instant, **the browser clamps the window's scroll to what still fits, and nothing puts it back.
  Measured: scrolled to 400, repainted, 0.** And it was the **sync**, every 30 seconds — not her.

### ★ v514/v522 — the class collision

⚠️ **The dead styling left when the two pop-ups were separated used a class name ALREADY TAKEN** — the Home
screen's own `.bake-line` — and being declared later, it won. **Every Home-screen bake line wore a green box
and a green left border from v514, and none of 3,400 tests saw it.** ⭐ **A dead rule is not harmless,
because it can be the one that wins** — the same class of fault this app already records from v394–v418.
Deleted, and the Home screen verified live back to `display:flex`, transparent, no border.

### v526 — the order row names the account

Her question: *"now i can see that an order had been paid, but how do i find out whether it is pay be TnG
cash or orthers?"* The row reads **Paid — TNG**, **Paid — Cash**, or whatever her own account is called,
read through the app's one reader (which knows the lowercase `cash`/`tng` every pre-v478 order holds) — the
thing that stops the old fault coming back, **the tag used to print "TNG" for a bank transfer, which is why
v478 took the account off the row in the first place.** An order paid with no account still reads just
"Paid"; an unpaid row carries no tag.

### ⚠️ Also in this batch, and worth keeping

⚠️ **`test/guide-builds.test.js` now SNAPSHOTS each PDF and writes it back byte-for-byte**, because running
the builders always changes the bytes (a date is stamped inside) — so **every test run was leaving
`changelog.pdf` and the two marketing PDFs showing as modified in GitHub Desktop, and a file that is always
ticked is a file she stops reading.** Shown, not asserted, the bakery's words for it. **Verified here: after
a full test run, `git status` is clean.**

**⚠️ LOCALIZATION.** Six conflicts, all the bakery's *"bake day"* / *"Bake days"* against jerky's
*"delivery day"* / *"Delivery Dates"* — the DAY word localizes, the BAKING word stays. ⚠️ **One new
user-visible string needed jerky's word:** the pop-up's *"not a bake day, so nothing here changes what the
shop offers"* is now *"not a delivery day, …"*, **and the assertion in `test/orders-day-sum.test.js` moved
with it** — ⚠️ **caught only because a bite run re-ran the suite; after a localization edit, re-run the
suite.** ⚠️ **The baking words themselves are kept on purpose** (`TOTAL BAKED`, "say what you baked",
`openBakedPopup`), consistent with the Production line's bread vocabulary she asked to be ported exactly.
⚠️ **And the whole-vocabulary sweep found PRE-EXISTING debt, not fixed here:** user-visible *"bake day"*
still sits in `admin/js/views/points.js` (×2), `admin/js/views/orders.js` (the Removed list's *"Bake \<date\>"*
and *"no bake day on it"*), and in `test/label.test.js` / `test/more-menu.test.js` fixtures — none of it the
Production line, none of it introduced by this sync. **Reported, not silently changed.**

## Engine v512 → v513 — the date on screen follows the clock, in both apps (16 Oct 2026)

One version from the bakery. **4 files changed (`+160 / −3`); no SQL and nothing to deploy** — the same
push carries it. Suite **3481 → 3482 pass / 0 fail**. **Zero merge conflicts** again.

**★ Her report, and her own follow-up question found a second one:** *"it is the 1st time that i saw the
app date not updated until i reload? Why?"* — then *"will it happen on storefront?"*

### The app

It drew its date **when the screen was drawn** and never looked at the clock again: only a navigation, a
reload, or a data pull that **changed** something repaints. **Measured: clock on Sat 17 Oct, the Home date
still Fri 16 Oct, and `visibilitychange` + `focus` changed nothing.**

⚠️ **And a second half that made it worse:** the app's other look-again listeners live in the loop that
only starts **after a cloud sign-in** — and "Use without cloud sync" starts neither. So with shared data
**off** (the state her own screen was in) the app registered **no timer, no focus and no visibility
listener at all.** The check now sits beside the router's own listener, which runs for every session.

⚠️ **And the bakery recorded its own first attempt honestly, which is worth keeping:** it put the check in
that same post-sign-in loop, reasoning the 30-second timer was already there — **and measured that it did
nothing. A fix placed on a code path the reporter's own state never reaches is not a fix — and it read as
correct.**

### The shop — already happening

⚠️ **The shop re-checks its DATA every 30 seconds and on the customer returning, and it redraws when that
data changed — but the date moving is not a data change.** Measured: clock on 17 Oct, customer back on the
tab, the green "today" ring still on 16, while the availability requests went out on every beat. ⭐ **The
one thing it DID already catch was a day crossing its 6pm cut-off — that drops a day, a real change — so
the cut-off was honest and the calendar was not.** Now `drawnDay` is written at the single repaint funnel
and `movedDay` joins the reasons to redraw.

### ⚠️ The test trap the bakery paid for, worth keeping

⚠️ **A module-scope `setInterval` in Node holds the process open.** Adding the timer plainly made **two
whole test FILES hang for the full 20-second timeout and report as failures**, with every test inside them
passing — and **neither file names `app.js` in its own imports.** It is `unref`'d now, with the reason
beside it. **Verified here: removing the `unref` hangs this repo's suite too.**
⚠️ **And a bite lesson of my own: removing the shop's `movedDay` left `test/store.test.js` GREEN — the
assertion lives in `test/app.test.js`, which reads `store/app.js` as TEXT.** Bite the file that actually
holds the assertion.

## Engine v511 → v512 — the calendar's arrows sit beside the date, and the green circle is explained (15 Oct 2026)

One version from the bakery. **6 files changed (`+132 / −14`); no SQL and nothing to deploy** — the same
push carries it. Suite **3480 → 3481 pass / 0 fail**.

**★ Her words, and both halves are hers:** *"on the calendar, the 2 arrows are too far away from centre,
they should appear just beside the date range, and simple note that date in green circle are bake dates."*

### The arrows

Both calendars' heads were a **three-column grid, `36px 1fr 36px`** — one arrow pinned to each edge of the
card with the date range stranded between them. ⚠️ **That was deliberate once:** it kept the TITLE centred
whether or not an arrow was drawn, and it does that perfectly. **But nobody looks at the middle track —
they look at the month**, and the two controls that move it were the furthest things on the card from it.
It is **one centred flex row, gap 10px, in the shop's calendar and the app's**. ⚠️ In the app this is
`.cal-head.weeks` **only** — the other five `.cal-head` calendars keep their `space-between` row on purpose
(they always draw both arrows). An empty slot is still a bare `.cal-slot` span (0 wide), so at the ends of
what she has published **the group shifts by an arrow's width rather than leaving a hole.**

### The green circle, explained

⚠️ **A first-time customer met a month of dates where some wear a green ring and some do not, and the only
thing that said what the ring meant was the day they finally TAPPED** — in the line underneath. **A symbol
a stranger has to tap to decode has not been explained**, and this is the one fact the whole grid turns on.
There is now a quiet line under the grid: **"Days in a green circle are posting days."** (12px, 5.40:1 on
the card, `.cal-key`.)

**And it DRAWS the symbol rather than describing it** — `.cal-key-dot` carries `inset 0 0 0 2px var(--green)`,
**byte-identical in form to the day's own ring** (`.cal-cell.avail .cal-num`), because **a legend that names
a colour has to show it.** ⚠️ Not theoretical here: this shop spent weeks drawing a green the app never used
(found at v510) and no test could see it. **The test now reads the legend's ring and the day's ring together.**

**⚠️ LOCALIZED for jerky, in all three languages.** The bakery's line reads *"bake days"*; jerky's shop says
**posting day**, so it is **"Days in a green circle are posting days."** / **"绿色圆圈里的日期是发货日。"** /
**"Tarikh dalam bulatan hijau ialah hari pos."** — following jerky's own existing words (`calChosen` already
uses 发货日 / *hari pos*). The Chinese and Malay are mine to be corrected, as with every other translated shop
line, and the comment beside each says so. **No test pinned the old wording.**

**Bitten:** turning the legend's ring into a plain dot, and putting the head back to the grid — both make
`test/orders-cal.test.js` fail by name.

## Engine v509 → v511 — the chosen day is a terracotta frame, and a closed order leaves the run (15 Oct 2026)

Two versions from the bakery. **8 files changed (`+254 / −12`); no SQL and nothing to deploy** — the same
push carries it. Suite **3479 → 3480 pass / 0 fail**.

### ★ v510 — the calendars, in both apps

Her words: *"the date change to terracotta solid. Change that to a terracotta wire frame so that the
wording inside can be seen clearly, the green ball dont have to go solid."* ⚠️ **She was measuring, not
guessing: the chosen day was a filled terracotta chip with white writing on it, and white on the brand
terracotta is 4.48:1 — under the 4.5 floor for body text, at 14px, in daylight.** It is now a **2px
terracotta frame round the whole day**, the date in the brand's dark terracotta at 5.51:1, and it is
drawn as an **inset shadow so nothing on the grid shifts 2px when a day is chosen.**

**And the green ring survives — in both apps.** *"the green ball dont have to turn solid"*, then on the
shop *"oversize like the one at app orders"* / *"rounded recangular"* (her correction after a first
attempt ringed the number instead of the day). ⚠️ **The rules that were eating it are DELETED, not
overridden.** That ring is the only mark saying a day is a posting day, **and choosing a day does not
un-post it** — it was being taken away at the moment she was deciding about that day. The shop's day box
grew **38px → 44px**: at 38 the 32px ball left 3px and the frame read as a band against it, and 38px was
also under the 44px floor for anything a thumb hits.

⚠️ **A REAL FAULT FOUND WHILE MEASURING — and jerky is already ahead on it.** The shop's calendar asked
for `var(--green, #6b8f4e)`: **a fallback, not a declaration**, so it quietly drew a different green from
the app while its own comment said they were the same, and `#6b8f4e` is **3.65:1 — under the floor — on
the day number of every posting day a customer could choose.** **Jerky declared `--green: #3b7449` in the
shop's `:root` back at v369, so nothing changes here**; the merge kept jerky's bare `var(--green)` and the
jerky-only-line audit confirms no stale fallback came back. *(The bakery has now declared the token too,
though it still writes the fallback beside it at two rules.)*
**Also applies to the app's other two calendars** (the inline date picker, and Bake days → Add dates),
because "this day is chosen" is one state, not three.

### ★ v511 — a closed order leaves the run

Her report: *"order that already mark shipped still appear in delivery run"*. ⚠️ **The run was asking the
COURIER a question only the ORDER can answer.** "Has this order already gone?" has two answers — the
courier telling the app, and **her pressing the stage on the row** — and v507 fixed only the first.
It is now `orderDone(order)`, **exported from `admin/js/state.js`** so there is one home for the reading
(`needsVan` in `admin/js/courier_job.js` asks it): a third copy is how three come to disagree.
⚠️ **The boundary is the half a careless fix breaks: only the LAST stage takes an order off the run** —
packed treats are exactly what the run exists to carry, and an order with no status reads as the FIRST
stage. ⚠️ **Checked rather than assumed: jerky's last stage id is `delivered`** (its label reads
"Collected / Posted") — so the fix is live here, not inert. **Bitten:** remove the guard and
`test/courier-job.test.js` fails by name.

**⚠️ This is the third time this same shape has appeared** — v494 (a van sent to her own kitchen), v507
(a van for an order the courier had already delivered), v511 (a van for an order she had closed with her
own hand). **Every one is a question that was right until the world moved on.**

## Engine v498 → v509 — the receipt clears itself, and nothing reloads on a timer (13 Oct 2026)

Eleven versions from the bakery. **9 files changed (`+634 / −526`) plus one new file
(`test/guide-builds.test.js`, 57 lines); no SQL and nothing to deploy** — the same push carries it.
Suite **3477 → 3479 pass / 0 fail**. ⚠️ **This range partly REVERSES what the last one added:** the
clear-the-page card is deleted outright.

### v499–v500, v509 — the shop never reloads itself

**Her question was the finding:** *"is automatic reloading of store a good idea? What i try is adding
customer details in it, the offer still shows."* ⚠️ **A page that reloads under someone's hands
destroys what they have typed**, and there is no honest way to tell "nobody is using this" from
"someone is mid-order" — **the guard it had was "has the page been scrolled?", a proxy, and the wrong
tool for a question whose wrong answer loses a customer's details.** So `autoReset` and
`scrollPageToTop` are **deleted**, not disabled. The last order's receipt now goes the moment a new
order begins — read off the shop's own state, in the one function every step change already passes
through, so there is no eighth call site to forget.

**Then she settled the whole feature herself** (*"remove the order to reload… make the green Order
Received! message vanish… 20sec instead of 1min"*): **the card, its "Not now", its Reload, its styles and
its three-language copy are gone, with every test of it.** `RECEIPT_LIFE_MS = 20000`, one number in one
place; the receipt is hidden **and emptied**, and the clock is asked again when someone looks at the page
(v497's lesson). ⚠️ **The cost is named rather than hidden: the order number and the tracking code leave
the screen with it.**

### v501–v504 — the out-of-date line becomes a strip

Her words: *"it is rather small. it should be a strip like what is having in the backoffice"*, then *"i
want it to be consistant with the app"*. It now wears **the app's own amber pair** (copied into the
shop's stylesheet at the admin's values, with the reason noted beside them), **16px words and a real 44px
press in terracotta** — the pale 14px bar with an underlined link is gone.

⚠️ **v502 pins it above the Order bar, and v503/v504 carry the lesson: `--bar-h` was used with a 92px
fallback and NOTHING EVER SET IT** — measured, the real bar is 100px, so the page's own foot padding had
been 8px short. `renderBar` now measures the real element; `--strip-h` is measured the same way.
⚠️ **And a fixed bar must reserve its own height** — the strip covered the offer by 97px until it did.
⚠️ **The bakery recorded its own trap here, worth keeping: its first measurement said 97px still covered
*after* the fix, because it had forced the card to the bottom with `scrollIntoView` — a position no
customer ends up in. An admitted-bad measurement is still being used if you act on it.**

### ★ v505–v508 — three faults, all out of her screenshots

- ★ **The next customer was inheriting the last one's collection centre.** The after-order reset cleared
  the *way* (`_picked`) and **never cleared `_pointId`** — and because the order carries that id, **an
  order could be stamped with a centre the customer never picked.** It now calls the shop's own
  `clearFor("point")` rather than a second clearing written beside it.
- ★ **The whole of step 3 comes back** (her rule: *"a rule about one control is a rule about the whole
  step"*): the card folds, the address clears, and **the ④ beside Place order goes out** — it was left
  lit, so the next customer arrived at a shop claiming a step was done. ⚠️ Its fix is an *ordering*
  fault: the green is set **twice** in the order path, so **a reset is only a reset if it is the last
  word.** ⚠️ And the bakery names its own limit: the two-customer comparison **cannot** catch this one,
  because the green is lit after *every* order so both customers agree either way — that piece is pinned
  by hand.
- ★ **An order the courier has already delivered no longer appears on the run** — `needsVan` asked *"does
  it go by courier?"* and never *"has it already gone?"*. **The same shape as v494's kitchen fault: a
  question that was right until the world moved on.** **Bitten here:** delete the line and
  `test/courier-job.test.js` fails by name.

**And the machine she asked for** (*"i think you alway forgot. How to make sure not to forget"*):
`test/store.test.js` puts **two different customers** through the shop and asserts it comes back in the
**same state** — deliberately not a list of things to reset, because a list is a thing somebody has to
remember to add to. **Bitten here:** delete `clearFor("point")` and both that test and the centre test
fail by name.

### v503 — a new guard on the manuals

`test/guide-builds.test.js` (**new in jerky**) runs Python's own parser over the three builders. The
manual is a Python file whose copy sits inside double-quoted strings, so **every inner quote must be
escaped, and a stray one stops it parsing — quietly**, leaving the previous PDF in place looking fine,
with `marketing/` gitignored so there is no version to restore. **It happened three times in one day at
the bakery.** ⚠️ **Checked here: jerky's `build_guide.py` does NOT have that defect** — both `{ENGINE}`
and `{VERSION}` already sit inside f-strings.

**⚠️ THE DELIBERATE NON-PORT, RE-CONFIRMED AND RE-APPLIED.** The bakery's range reworks the after-order
reset so that **arriving and resetting are the same call** — its two call sites now say `apply("")`
(arrive) and `apply("collect")` (reset). **Jerky keeps Post (nationwide) at both**, and the merge's two
conflicts in `store/app.js` were resolved by taking the bakery's expanded reset and putting
`apply("courier")` back into each, with the reason written beside them.

## Engine v493 → v498 — no van to your own kitchen, and a receipt that offers to clear the page (13 Oct 2026)

Five versions from the bakery. **10 files changed (`+867 / −32`); no SQL and nothing to deploy** — the
same push carries it. Suite **3469 → 3477 pass / 0 fail**.

### ★ v494 — the fix for what she reported

Her words on 12 October: *"we dont do delivery run on self collection point which is the kitchen."*
`needsVan()` in `admin/js/courier_job.js` asked **"does this order have a Point?"** — exactly right when
the kitchen was *the absence of a Point*, and wrong from the moment the kitchen **became** a Point (so
it could be picked in the shop), because then it had an `id` and the run began sending a van to her own
kitchen. It now reads **`return !!point && point.isKitchen !== true`** — off the **kitchen switch**,
never the name. One function, so the run screen and the Delivery dates screen's own "Run (N)" count fix
together. ⚠️ **3,422 tests were green while a van was being sent to her own kitchen** — the two tests
beside it were both correct and neither was watching this case, because when they were written the
kitchen had no Point to be watched by. **Bitten here:** revert the line and `test/courier-job.test.js`
fails by name.

### The shop's receipt offer (v495, v497, v498)

`store/app.js` + `store/app.css` + `store-lang.js` ×3. The form has always cleared itself on an order
(v465); **the PAGE did not** — it rested on the receipt, so the next customer had to work out that the
shop above was already fresh. A minute later the receipt carries **"All done? Clearing the page starts a
fresh shop for the next order"** with one press; **showing it moves nothing**; leave it and the same wait
again, then the page clears itself. **The receipt stays** (her answer when asked which she wanted:
*"clear the form"* — the order number and code are the two things the customer needs next), and **it
never drags someone who has scrolled** since the offer went up.

⚠️ **v498 corrects my own build.** The first version was a scroll to the top labelled *"Back to the top"*
— her ask was to clear the page, and the label was my words for my action, so every report back read
"no reload" and was exactly right. It now **reloads** (a genuinely fresh shop, and an old build picks up
the new one) and says what it costs first. ⚠️ **And "relatively small" was measurably correct:** the
sentence wore a caption's style and the button the build notice's inline-link style — a **~26px target**
for the one control the whole feature exists to get pressed, against a 44px floor. Now 16px in the shop's
own ink (12.6:1) and a real 44px target in terracotta (5.92:1). **The fault was the REUSE** — a style
belongs to its job, the same shape as "CashMove these" at v486.

⚠️ **v497: a timer in a page nobody is looking at does not run**, and that is the ordinary case here (she
puts the phone down, or opens WhatsApp). Measured: `visibilityState` was `hidden` and the 60-second timer
had never fired. The shop now asks the clock on **focus / visibilitychange / pointerdown** as well as on
the timer, and clears the page only once the OFFER itself has been readable for its own minute.

### ★ v496 — the shop can tell which build it is (a hole in her own feature)

Her report: *"now v495, but store at v494, why no update warning at store?"* ⚠️ **The notice read BOTH
of its numbers out of `admin/js/version.js`** — which build this page is, and which build the site is
serving. **Two readings of one file cannot disagree about which build the code is**, so a browser that
revalidated that little file made a month-old shop report itself as current and say nothing. **`export
const SHOP_BUILD` is now a literal in `store/app.js`**, so an old copy carries its own old number with
it; the footer prints it and the probe compares against it. ⚠️ **A second place for one fact, accepted
only because a test fails the moment the two disagree** — verified here by drifting `SHOP_BUILD` to
`497` and watching two tests go red. And **`newerBuild` no longer has a default build** — a default was
exactly what a caller could lean on by accident, and the default WAS this fault; **`store/build.js` no
longer imports the file it probes** (it now has no imports at all).

**⚠️ THE DELIBERATE NON-PORT, UNCHANGED.** jerky's shop still opens with Post (nationwide) chosen —
none of these five versions touches the fulfilment default, and `test/store.test.js`'s care with
`dayPicked` (the cold-start test must run first) is unaffected.

## Engine v476 → v493 — every place money sits is an account, and one warning at the field (12 Oct 2026)

Seventeen versions from the bakery. **22 files changed (`+2,806 / −864`) plus one new file
(`store/build.js`, 85 lines); no SQL and nothing to deploy** — the same push carries it. Suite
**3445 → 3469 pass / 0 fail**.

### The money screen is one list of accounts (v477–v491)

**`admin/js/accounts.js` is the whole of it.** Every place money sits — the tin, the phone, the bank,
LK's hand, a loan — is one account with a name, and the two vocabularies the app had been carrying
(the "purse and phone" against the "pockets") are gone. `admin/js/views/money.js` renders one block per
account — in / out / holds — for **every** account that exists, so a just-added account is visible at
RM 0.00 instead of nowhere (v479), and each block is a door into that account's journal. One **Pay**
press opens her own list with `+ New way to pay` at its foot (v478), and the order tag is one word,
**Paid** — it used to print the method, so an order paid into a bank account wore a TNG tag.

**★ The fault the rename question found (v486).** Renaming a way to pay rewrote the expenses and the
deposits and **never the orders** — so every order paid the old way stayed under a retired name, and
the Money screen showed a block (the "Cash" RM 64) that was not on her list. Rename and the new **Move
these** now call the **same** function, so neither can move two of three places again. Its test fails
by its own name (`'Loan'` against `'Bank OD'`) with the orders left out.

**★ Nothing a transaction uses can be deleted (v487).** The refusal **names the count** and the way
through (`Move its records…`, v486), and `isCash`/`isTng` are locked outright with their Delete not
drawn rather than drawn-and-refusing. ⚠️ The rule's test took two tries: **the first version passed
with the rule OFF**, because it read a list nothing had touched.

**Net counts every account now (v480)** — her choice, shown the trade-off in full (it no longer matches
what she can count by hand). **One grid for the whole table (v489)**: heading and rows are `display:
contents`, so `RM 480.00` stops wrapping by one pixel and every column shares one right edge.

**A paid order made cheaper says so (v490), and asks to refund (v491)** — the amount is named and the
refund opens on that order, because a figure she has to retype is a figure retyped wrong.

### The shop (v489, v492, v493)

**⚠️ `store/build.js` is adopted from the bakery (v492) and replaces jerky's own notice code.** The
behaviour is hers already (v476) — what arrives is the bakery's **better split**: `VERSION_URL`,
`buildIn(servedText)` (exported separately because `newerBuild` answers `false` for both "they agree"
and "cannot read", so a test asking only `newerBuild` could never tell them apart), and
`newerBuild(servedText, running = ENGINE_VERSION)`. **`BUILD_TRIED_KEY` is `"munchies.shop.build"`** —
origin-scoped, never the bakery's.

**⚠️ Three collisions the merge produced, all de-duplicated:** a second `build.js` import, a second
notice block in `store/app.js`, and a second reload wiring. ⭐ **`test/no-duplicate-imports.test.js`
caught the import** — the guard written after the bakery's three earlier burnings. The bakery's
`test/store-build-notice.test.js` (10 tests, broader than jerky's 8) replaces jerky's file of the same
name, and the bakery's `test/store-lang-switch.test.js` replaces the narrowed guard.

**★ The step refusals ask which step is first missing (v493).** `stepsDone()` is the one place the
three circles' done-ness is computed; `firstMissingStep()` reads it; `STEP_SAY` gives each step its own
sentence and `STEP_FIELD` puts the line under **the field** (step 3 → the two cards, not the tall
card's foot). Three footer banners that fought that scroll are retired. v489 also removed the
top-scroll that made the shop jump after **Place order**.

**⚠️ THE ONE DELIBERATE NON-PORT, RE-CONFIRMED.** jerky's shop still **opens with Post (nationwide)
chosen** — `apply("courier")` at start-up and in `_resetFulfillment` — where the bakery's v416 opens
with neither. ⚠️ **Checked rather than assumed:** `refuseAtFirstMissing()` **cannot** reach step 3 on
jerky's shop, because the Place-order guard (`if (!lines.length)`) only runs on an **empty basket**,
where step 2 is missing first; the bakery's direct `sayStepFirst("fulfilAskTitle", …, "step3")` sits
behind `!fulfilEl._value`, which is never true here. **So no order is blocked by the pre-chosen Post.**
`STEP_SAY.step3` is kept, so the gate is ready if she ever wants it. ⚠️ Pre-existing from Pass B and
unchanged by this sync: the third circle stays grey until the customer **taps** a card, because the
rule asks whether **he** chose, not what the stored value happens to be.

### ⚠️ The jerky-only-line audit: four files, all deliberate

A diff of jerky's HEAD against the bakery base found jerky-only lines gone in
**`admin/js/views/orders.js`** (3 reworded comments), **`store/app.js`** (51 — her notice block,
superseded by `store/build.js`), **`test/store-build-notice.test.js`** (148) and
**`test/store-lang-switch.test.js`** (29) — the two test files replaced by the bakery's broader
versions of the same rules. **Checked one by one: no genuine loss.**

## The shop now says when it is out of date (12 Oct 2026)

**Her report:** *"why the store behave differently from the bakers store?"* — and it did not. **Her
phone was running an old build of the shop** and there was no way to tell. The app on that same phone
has had an amber "Update now" strip since v255; **the shop had nothing.** She answered it herself:
*"sorry old cache, v400"*.

**⚠️ WHY THE SHOP NEEDS IT MORE THAN THE APP.** The shop re-fetches its **data** every 30 seconds and
**never its own code** — so a stale page shows **fresh numbers on stale behaviour**, every figure
agreeing with her, which is the worst way round for a fault to be. And a shop is a page a customer can
leave open across a deploy: an order placed against old code is a real order placed wrongly.

**What was built.** `store/app.js` gains `checkBuild()`: it fetches `../admin/js/version.js` — **the
same file it already imports its own number from**, so the two can never be different builds — with
**`cache: "no-store"`** (the one thing that must not be cached is the answer to "is this cached?"),
and compares. It rides the page's **own 30-second `poll`**, which already means "the customer is here
and looking" (it skips a backgrounded tab and fires on visibility, focus, online), plus once on
arrival, un-awaited.

**The decision is pure and exported** — `newerBuild(servedText, running)` — the same shape as
`clockWords`/`postsOn`, so the part worth pinning needs no page. ⚠️ **It answers `false` when it cannot
tell**: empty text, whitespace, a captive-portal login page, a file with no engine number, a
non-numeric build. **A page that cried "out of date" on a bad connection would be worse than one that
never spoke.**

**The notice** (`store/index.html` + `store/app.css` + `store-lang.js`, all three languages) is a
**quiet bar above the banner**, authored `hidden`, `position: relative` so it **pushes the page down
rather than covering it**, wrapping rather than clipping. It wears the shop's own `--brown-dark` text
token — **not a warning's amber or red**: nothing is broken and the customer has done nothing wrong.

**⚠️ THE TWO-STEP, WHICH IS THE PART WORTH KEEPING.** Pressing Reload can serve the **same old script
straight back** (the browser is still holding it) — the fault the app's strip learned at v256. So the
press **remembers first, in `sessionStorage`** (a reload wipes memory, which is the whole problem), and
the second sight of the notice swaps the sentence for *"Close this page completely, then open it
again"* and **removes the press** rather than leaving a button that does nothing.

**⚠️ ONE EXISTING GUARD HAD TO BE NARROWED, HONESTLY.** `test/store-lang-switch.test.js` banned
`location.reload(` **anywhere in the file**, as a proxy for the v71 rule *"the language switch must
stay in place"*. That ban could not tell a language switch from a build notice — it would have
forbidden both. It now pins the rule **where it belongs** (the switch's own body and the pill's press
contain no reload) **and keeps the ban's real value** with a third assertion: the shop carries
**exactly one** reload, and it is inside the build notice's press. **A guard narrowed without that
replacement is a guard gone quiet.**

**Tests: `test/store-build-notice.test.js` (8, new)** — a newer build found; the running build not
called newer than itself; **seven "cannot tell" shapes all silent**; the `no-store` ask and the shared
import verified against the source; the press remembering before it reloads; the markup authored
hidden; and the three keys present, translated and matching the page's English. Suite **3437 → 3445
pass / 0 fail**. **Browser-verified at 375 px:** hidden by default, and both states laid out correctly —
44 px and 59 px tall, no horizontal overflow, the press in the shop's own text colour.

**⚠️ THE SAME GAP IS ALMOST CERTAINLY IN THE BAKERY'S SHOP** — it has the identical
`store/` design and the same admin-only strip. A note has been left in its bridge.

## The big catch-up, PASS B — the shop page (12 Oct 2026)

The eighteen files Pass A deliberately left alone: `store/app.js` (1,338 lines), `store/index.html`,
`store-lang.js`, `store/app.css`, `store/pin_map.js`, the eleven shop tests and two new ones. Suite
**3373 → 3437 pass / 0 fail**. Engine unchanged at **v476** — nothing to deploy.

**Conflicts:** `store/app.js` 8, `store/index.html` 3, `store-lang.js` 36, plus 19 across the shop
tests. **The merge recipe that worked, and is worth reusing:** for `store-lang.js`, take the bakery's
block and override each key's value with jerky's where jerky had its own (**112 values kept**) — then
localize the genuinely new keys in all three languages. For the shop tests, take the bakery's
structure and localize the day word.

### ★ THE DEFECT THE PORT FOUND — two fallbacks, one fact

`store/app.js` had **two different defaults for the same thing**:

```js
// the press's gate:            _value || "courier"
// the order it then wrote:     _value || "collect"     ← the bakery's default
```

**Two places holding one rule and disagreeing.** An order placed with no way chosen was *checked* as
Post (and so asked for a postal address) and *written* as a collection — the customer told to post it,
the backoffice told to keep it back. **Caught by the test that places an order with no way chosen**,
which is exactly the kind of test that only exists because the behaviour was pinned. Both now say Post.

### ⚠️ THE TWO DELIBERATE NON-PORTS — her choice, confirmed 2026-10-12

1. **The shop opens with Post (nationwide) chosen.** The bakery's v415/v416 opens with neither chosen —
   *"a page that opens with one of them edged has answered its own question"*. **She kept her own
   model**, so the courier card wears `active` from the first paint and `apply("courier")` runs at
   start-up. Markup, `order()`'s gate and the payload's fallback **all say Post** — the pair above is
   what happens when they do not.
2. **The v416 "say how you will get it" gate is not ported.** Jerky's own postal-address rule stands.
   Two shop tests were **reversed** for this, each with the reason written beside it.

### ⚠️ THE STEP LOCK — the thing that blocked the first attempt

Bakery v454 makes `+` refuse until the customer taps a day. **The ported helpers took the FIRST
`tappable` cell**, which also matches a closed or askable day — so the tap landed, set nothing, and
every `+` was refused: the shop rendered correctly and the tests read an empty basket.

⚠️ **A blanket fix made it worse** (requiring `avail` everywhere fixed the empty-basket tests and broke
tests that tap a closed day on purpose) — **which is what told me to revert rather than push on.** The
final fix is **per test**: `avail` on the helpers that exist to open step 2, and a chosen way or a
postal address added where a test drives the flow jerky keeps. **When a port adds a GATE, every test
that drove the old flow through it has to be looked at individually.**

### Also localized

`health.js`-style sweeps across the shop's new copy in **all three languages**: `ansClosed` (*"Today's
order window has closed"* / 今天的发货已经截单 / Tempahan hari ini sudah ditutup), the four
`askToDelivery*`/`askToCollect*` confirmation lines, `bakeDayWhat`, `selfCollectSub`, `courierSub`,
`pointPick`, `calChosenFor`, `needDay*` — with jerky's `零食`/`snek`, `发货日`/`Hari pos`,
`邮寄`/`Pos`, `自取`/`Ambil sendiri`. **A dead `collectFrom` key removed** (nothing called it since the
place list moved inside the collect card). **Three duplicate keys** removed from the by-rule merge.

**⚠️ NOT changed, and worth her eye:** a few *older* shop strings still use the bakery's words —
`trackDelivery: "Track your delivery:"` beside "Track your order" elsewhere, and
`noteLabel: "Notes for Collection/Delivery (optional)"`. They predate this sync, so they are a copy
decision rather than a port, and they are listed for her rather than changed silently.

**Browser-verified at 375 px in all three languages:** no bakery wording renders, no horizontal
overflow, nothing prints `null`.

## Engine v401 → v476 — the big catch-up, PASS A: the back office (12 Oct 2026)

Base `cc83293` (bakery v401) → `ad70390` (v476). **72 commits, 87 files in the bakery's range; 68
written here, 18 deferred to Pass B.** Suite **3219 → 3373 pass / 0 fail**, engine **v476**.

**⚠️ THIS IS A DELIBERATE SPLIT — AGREED WITH THE OWNER BEFORE ANY FILE WAS WRITTEN.** The range
contains a 1,338-line rewrite of `store/app.js` (the customer-facing shop). Porting that in the same
pass as 60 admin versions would put a rewrite of her shop in front of customers in one step, with no
phone test. So the split is:

- **Pass A (this):** the whole back office — `admin/js/**`, `admin/css/app.css`, `supabase/order_alerts.sql`, the eight new admin tests. 40 source files written from merges, 6 new modules/views, 8 new tests.
- **Pass B (next):** `store/app.js`, `store/index.html`, `store-lang.js`, `store/app.css`, `store/pin_map.js` and the 11 shop tests — **untouched and byte-identical today.**

### ★ THE ONE THAT MATTERS: the sync batch guard (v467)

The bakery hit a fault where **one record that cannot be sent makes the server refuse the whole
batch** — every device stops syncing, and it cost them real work on 11 October. Measured here:
`admin/js/sync.js`'s `flush` built its POST body from **every** pending record with **no guard**, so
munchies had the same exposure. The guard now drops a record with no usable `id`/`kind` from the batch
so the rest still goes, and v475's sweep runs **before** the send decision so a queue holding only such
a record clears instead of reporting "OK" for ever.

### Adopted (admin side)

**New: `health.js` + `views/health.js`** — *Check my system*, a read-only screen running fifteen
record-integrity checks (an order twice, an order on the live AND Removed list, an order on a day that
no longer exists, a coupon counted twice, a receipt matched by number rather than by a quoted name, the
reach and content sync checks), **with "could not run" counted separately from a pass**.
**New: `pointAreas.js` + view** — collection Points grouped under Areas. **New: `deliveryRoutes.js` +
view** — van runs, with the days a Place is served.

**`state.js`** gains the lists these need (`removedOrders` 48-hour keep, `voidedReceipts`,
`declinedCoupons`, `pointAreas`, `deliveryRoutes`), `removeOrders` as the single removal door,
`dropStaleShelfRows`, and `codeFromId`. **`orders.js`** gains the Removed card, the coupon control,
typeable quantities, whole-order moves and past-day editing. Plus the Receipt register's void marking,
Money/Profit period pickers, the `moneyTagOf` truth fix, `courierDay` on the mailing label, and the
rest of the 72.

### ⚠️ THE AUDIT DID ITS JOB — a real regression caught

The jerky-only-line audit (diff each merged file against the bakery base, then assert every jerky line
survives) reported six files. Four were deliberate changes; **three were real losses from taking the
bakery's side of a conflict** and were restored:

| file | what was lost |
|---|---|
| `admin/js/views/customers.js` | jerky's **"Post (nationwide)" / "Collect (local)"** replaced by the bakery's "Courier"/"Self collect" — **a user-visible regression** |
| `admin/js/state.js` | jerky's "pet name" comment (bakery: "dog name") |
| `admin/js/views/orders.js` | jerky's "Delivery date" comment (bakery: "Bake day") |

The re-run reports **0 unexplained losses across 68 files**.

### Also found and fixed

- **`no-duplicate-imports` caught two more** "keep both sides" duplicates — `referrals.js` (`fmtRM` ×4)
  and `views/money.js` (`dayMonth`) — the sixth and seventh of that mistake. Merged, not dropped, so
  both jerky's and the bakery's names survive.
- **A test of my own had expired.** `test/availability-agrees.test.js` hardcoded `2026-10-09`, and
  `nextDeliveryDates` now filters past days — so it began failing on its own on 2026-10-12. The date is
  built from today now. **A hardcoded future date is a test that rots.**
- **Localized:** `health.js`'s copy said "bake day" ×5 and "bread" ×2 → jerky's **"delivery date"** and
  **"treats"**; `points.js`'s comment reworded so it stops reading as a `More → X` signpost; and four
  assertions on that copy moved with it (`health.test.js` ×3, `label.test.js` ×2, `confirm.test.js`).

**⚠️ Re-run `supabase/order_alerts.sql`** — one line, idempotent.

## Engine v400 → v401 — a shopping list you write yourself (9 Oct 2026)

Base `1a567e3` → `cc83293`. 7 files, ~248 insertions. **3 conflicts across 2 files**, suite
**3217 → 3219 pass / 0 fail**, engine **v401**, **0 lost jerky-only lines**. No SQL, nothing to deploy.

**Adopted:** the **hand-written shopping list** — a new *＋ Write a list by hand* press on the PO screen
(and on its **empty** state, which previously stopped at one sentence and would have hidden the new
press exactly when it is most useful). Pick products and quantities; the ingredients come out of her
recipes and price in whole packs from the cheapest supplier, the same as a day's list. The whole rest of
the process is unchanged machinery — PO history, per-shop groups, **Buy / Not buying**, Undo, *Print
this shop*, **Amend** — and **`po.manual` records no day at all**, so saving it can never tick a day off
and deleting it can never un-tick one (an *absence*, not a rule, so nothing can forget it). Also
`admin/js/bom.js`'s manual-list support and the new "Written by hand" label.

**⚠️ TWO USER-VISIBLE "bake day" STRINGS FOUND IN JERKY'S OWN ADMIN — MISSED IN EARLIER SYNCS, FIXED
HERE.** Both arrived with batches reviewed for the word "*bakery*" and not for the word "*bake day*":

- `admin/js/consolidated.js` — *"Every order is listed on the day it is FOR — the bake day"*, the
  undated-orders note, and the subtitle's *"by bake day"* (from the v369→v382 batch).
- `admin/js/supabase.js` — `whyUnimportable`'s *"it arrived with no bake day on it"*, which is the
  amber notice on the Orders screen (from the v364 batch).

Jerky's admin says **delivery date**, so all four now do. **Five assertions on that copy moved with it**
(`test/consolidated.test.js` ×3, `test/consolidated-view.test.js`, `test/supabase.test.js`) — an
assertion on user-visible text localizes; the bakery-voice *comments* stay.

**⚠️ EXAMPLE OF THE BIGGER MISS.** The real lesson is that **a per-sync localization check keyed to one
word will miss the others.** "*bakery*" was checked every pass; "*bake day*", "*flour*" (also caught this
week) and "*loaf*" were not. The remaining `bake day` strings in `production.js`, `scenario.js` and the
Guide are **deliberate** (the Production line's bread vocabulary, ported exactly as she asked).

**Localization of the new feature:** the panel's copy and the delete confirmation say **"posting day"**
(the PO screen's own day word, localized at the first sync), not the bakery's "bake day".

**Browser-verified:** the PO screen's empty state reads *"No delivery dates … Or write a list by hand,
which needs no delivery date at all"* with the new press; the panel opens; **no "bake day" renders**, and
nothing prints `null`/`undefined`.

## Engine v399 → v400 — the press says Buy, and becomes Bought (9 Oct 2026)

Base `ebd90cf` → `1a567e3`. **Three files, 0 conflicts**, engine **v400**, suite **3215 → 3217 pass / 0
fail**. The **jerky-only-line audit reported 0 lost lines**. No SQL, nothing to deploy.

Her ask: *"can the button initially say buy, after buy it become bought?"* `admin/js/views/history.js`'s
per-shop press said **"Bought ✓"** and now says **"Buy"**; the record it is replaced by still reads
*"Bought 9 Oct, 11:42"*, with **Undo** beside it. The bakery's reasoning, which is worth keeping: *"Bought
✓" was doing two jobs and only one well* — on the *press* the past tense plus a tick read as already
done, while pressing it only opens *"What did you pay?"*; and the pair is now coherent, **Buy / Not
buying** being the two answers to one question rather than a verdict beside a decision.

**⚠️ ONE OPEN QUESTION PASSED TO HER, NOT SETTLED HERE.** The shopping list's table carries a column
headed **BUY** (the quantity to buy — `admin/js/views/poTable.js:62`) and a **Buy** button now sits on
the same screen beside each shop's name. Different things (a heading against a press), but the bakery
flagged that the two may read as confusing and offered to rename one. **That is her call, not ours**,
and renaming a heading is a copy change she should make knowingly.

## Engine v393 → v399 — your own money, more than one owner, your own order (9 Oct 2026)

Base `136b78f` → `ebd90cf`. 14 files, ~1,029 insertions. **5 conflicts across 3 files** (`admin/js/money.js`
×2, `admin/js/views/accountsEditor.js` ×1, `admin/js/views/money.js` ×2). Suite **3197 → 3215 pass / 0
fail**. Engine **v399**. **No SQL, no `store/` change, nothing to deploy.**

**★ THE NEW GUARD CAUGHT STRIKE FOUR — on its first real use.** My "keep both sides" resolution of
`views/money.js`'s import block inserted `import { clearCourierCharge } from "../courier.js"` while the
file already had it. `test/no-duplicate-imports.test.js` (added yesterday, after the same mistake bit
three times) **failed by name, naming the file and the binding** — no `Identifier … is not defined`
hunt, no "why did every test file fail to load". That is the whole point of writing it as a test rather
than a checklist item. *(The jerky-only-line audit flags it too, but as a "deliberately changed" line —
the duplicate guard is what names it properly.)*

**Conflicts, and how each was settled — jerky's localized wording kept, the bakery's new code taken:**
- `admin/js/money.js` ×2 — jerky's "she"→"you" comment rewordings kept, the bakery's **new** comment and
  its whole **v396 investment block** appended.
- `admin/js/views/accountsEditor.js` — jerky's own example (`"e.g. Pet expo"`, where the bakery says
  `"e.g. Baking class"`) **kept**, and the bakery's new `isSource ? "e.g. Maybank savings"` branch added.
- `admin/js/views/money.js` ×2 — the import list merged (the bakery's `investmentOf`,
  `classOfCategory`, `isOther`, `sourcesOf` **plus** jerky's `clearCourierCharge`), and the bakery's new
  v394 sentence taken **in jerky's voice**: *"Money you have INVESTED in the business …"* where the
  bakery says "in the bakery".

**Localization — nine user-visible strings, all the same word.** The batch added an investment account
whose copy says "the bakery" throughout. Jerky already says **"the business"** in its own money code, so
these all moved: *"The business owes me"*, *"…it stays in the business"*, *"…so the business owes it
back to you"*, *"So each owner's share of the business reads on its own"*, *"Still in the business"*,
*"…gone into the business is listed here"*, *"Every ringgit of your own that has gone into the
business…"*, *"…has already been spent on **ingredients**…"* (the bakery says **"flour"**), and
*"Money of your own that has gone into the business · all time"*. **One test assertion moved with them**
(`test/money-lists.test.js` asserts the visible label `"The business owes me"` — an assertion on
user-visible copy, which localizes; the file's *comments* keep the bakery's voice on purpose).

**Adopted:** **v394** — "Put money in" is an **investment**, the pocket stops claiming a debt for money
she marked as invested (the same ringgit can never be counted twice), and *Put money in* asks **where
the money came from** from a third list of her own beside categories and ways to pay; **v396** — the
**Your investment** card (put in / taken back / still in, **all-time on purpose**, with an Open sheet she
can Print or Share, counting by the **class** behind her withdrawal category rather than by its words);
**v397** — **Transfer** between her own pots (never money in or out); **v398** — **more than one owner**,
each share kept on its own, withdrawals naming their owner, and unowned money shown in its own section;
**v399** — a **drag grip** on every ingredient, order written onto the ingredients themselves.

**Browser-verified:** the Money screen carries **"Your investment"** with *"gone into the business ·
all time"*, the **Transfer** button, and *"The business owes me"*; **no "bakery" or "flour" renders
anywhere**, and nothing prints `null`/`undefined`.

## Engine v384 → v393 — stock, and the shopping that fills it (9 Oct 2026)

Base `651cc94` → `136b78f`. 21 files, ~2,262 insertions. **One conflict** (`admin/js/views/money.js`:
the bakery's v390 `dayMonth` import against jerky's `clearCourierCharge` import — **kept both**). Suite
**3148 → 3197 pass / 0 fail**. Engine **v393**. **No SQL, no `store/` change, nothing to deploy.**

**⚠️⚠️ AND THE SAME RESOLUTION SHAPE BIT FOR THE THIRD TIME — SO IT IS NOW A TEST.** "Keep both
sides" on `views/money.js` inserted the bakery's `dates.js` import while jerky's own stayed above it:
`Identifier 'longDate' has already been declared`, and **every test file failed to load.** The three
occurrences are all one mistake — *a hand resolution inserting a line the other side already had*:

| version | file | duplicate |
|---|---|---|
| v368 | `admin/js/app.js` | `renderReceiptRegister` ×3 |
| v382 | `admin/js/supabase.js` | the `bom.js` import |
| v393 | `admin/js/views/money.js` | the `dates.js` import |

**New `test/no-duplicate-imports.test.js`** walks `admin/js/**` and `store/**`, collects every named
and default binding each module imports, and fails **naming the file and the bindings**. **Bitten:**
re-introducing the `dates.js` line fails it with both bindings listed. A check nobody runs is the fault
it was written for — the suite caught all three, and now it catches them before the diagnosis is needed.

**Adopted:** **v385** — the ingredient journal opens in two parts, **PRICE** and **STOCK**, recording
every movement and what caused it (five things move stock and every one used to overwrite the number);
**v386** — the **Stock card**, on every ingredient, stock before price, with an empty card explaining
itself; **v387** — each shop's list prints on its own (the day's ordinary Print untouched); **v388** —
ticking a bake day uses `history.replaceState` so the PO page stops jumping to the top (the
`scrollTop = 0` that looked like the culprit was doing nothing); **v390** — the stock card becomes a
real table (*WHEN · WHAT HAPPENED · CHANGE*), a line can be removed with a ✕, and **each shop's
heading carries its own Bought press** (before it put every ingredient on the whole list into stock);
**v391** — deleting a list names the money it leaves behind; **v393** — **Undo one shop's Bought**,
touching only that shop, never letting stock go below zero, and deliberately not offered on lists
bought before it existed; and the **`.btn-row` wrap** fix (her words: *"i cant find the delete button"*
— the row measured 403px on a 360px screen and Delete sat off the edge).

**Localization:** every user-visible string added in this batch was reviewed — all generic ("shop"
here means the supplier she buys from, e.g. Mydin). No bakery wording, no bakery identity; `CNAME` and
her Supabase project untouched.

## Engine v382 → v384 — a review's picture, and a phone that updates first (8 Oct 2026)

Base `8beb8f7` → `651cc94`. 14 files, ~995 insertions. **0 conflicts in all 12 source files.** Suite
**3125 → 3148 pass / 0 fail**. The **jerky-only-line audit reported 0 lost lines** across every file
(supabase.js 56, supabase.test.js 67, reviews.sql 43, app.css 28, reviews.js 24, …).

**⚠️ `supabase/reviews.sql` — A SECURITY FIX, AND NOT OPTIONAL BEFORE DEPLOYING.** A customer's review
photo was uploaded straight into the **public** `review-photos` bucket, so it was fetchable by anyone
holding its link **before the review was ever approved** — the policy claimed only approved pictures
were readable, and it was not true. Nor did either bucket have a size or type limit.

Adopted: uploads now go to a **new private bucket `review-photos-pending`** (reachable by no anonymous
reader, not even with the exact link); **Publish** copies the file across to `review-photos` in the
same breath and stores the public path; **a failed move does NOT publish** (the card says why — the
other way round would put a review on the homepage with its picture missing); **taking a review down
deletes the public copy** while the private original is kept, so re-publishing restores the same
picture without asking the customer again; the anon insert policy is now `with check (published =
false)` — **a visitor may ADD a review, but may not arrive with one already published**; and both
buckets get `file_size_limit = 2097152` and an image-only `allowed_mime_types`.

**⚠️ The shop now uploads to a bucket that does not exist in her project until the script is run** —
`reviews.js` (the homepage script) posts to `/storage/v1/object/review-photos-pending/…`, so **until
`supabase/reviews.sql` is re-run, a customer's review photo cannot be uploaded at all.**

**v383** (`admin/js/freshness.js`, `admin/js/app.js`): a phone running an older build now **updates
itself before the password screen**, rather than showing the update strip only after the PIN is in.

**Localization:** every new string checked (the reviews card's "It is still waiting — publish it once
you can see it.", "Loading the picture…", the delete confirmations). All generic; no bakery wording,
no bakery identity; `CNAME` and her Supabase project untouched.

## Engine v369 → v382 — thirteen versions (8 Oct 2026)

Base `b400046` → `8beb8f7`. **39 files, ~4,661 insertions.** `git merge-file -p --diff3` per file with
**index-keyed temp names** (never basenames — two pairs collide here: `customers.js` and `profit.js`
each exist both in `admin/js/` and `admin/js/views/`). **7 conflicts across 5 files**; suite
**3026 → 3125 pass / 0 fail**. No engine delta owed in either direction.

**Adopted:** the refund amount + what it was for (v370/v371, plus `refund_receipt(p_order_code,
p_amount)` and a new `refunded_amount` column in `supabase/receipts.sql`); the **consolidated
invoice** (`admin/js/consolidated.js` + `admin/js/views/consolidated.js`, `/consolidated`, More →
📑, v372/v373/v376/v377/v378); **v374's real "forget me"** (`publishTracking` now **reports whether
the customer's card was actually written**, because the forget control has to be able to say *"their
name is still on the shop's public card"* rather than report a half-kept promise as whole); v375's
count fix; **v380's frozen cost** (`orderLineCost` — the exact mirror of `orderLinePrice`, so a sale's
cost is as fixed as its price — plus the `v380` catch-up that writes the cost the books were **already**
reading, so no figure moves); v381/v382's **order-number doors**.

**Conflicts, and how each was settled** — all in jerky's favour where jerky had its own work:
- `admin/js/supabase.js` (1): the `bom.js` import. **Taking the bakery's line verbatim asks for
  `totalUnitsOnDate`, which jerky DELETED in the 7 Oct fix** → `bookedUnitsOnDate` kept, `costOf` added.
  (The suite caught this immediately: *"does not provide an export named 'totalUnitsOnDate'"*.)
- `admin/js/money.js` (2): jerky's localized comment kept; **the bakery's v370 takings block taken**
  (`orderNet`, and the refund guard kept explicit rather than falling out of the arithmetic).
- `admin/js/profit.js` (2): the bakery's `orderLineCost` / roll-up taken whole.
- `admin/js/views/customers.js` (1): the bakery's order-number door taken, **jerky's fulfilment labels
  kept** — *"Post (nationwide)" / "Collect (local)"*, not the bakery's *"Courier"/"Self collect"*.
- `test/supabase.test.js` (1): both sides kept (jerky's orphan-sweep tests **and** the bakery's new
  `publishTracking` tests).

**⚠️ A duplicate import slipped through and was caught by the suite**: taking "theirs" on money.js's
first hunk inserted the bakery's import while jerky's own stayed above it — `Identifier 'groupOrders'
has already been declared`, failing every test file at load. Removed.

**An automated audit of jerky-only lines** (diff each merged file against jerky's HEAD, then check
each line survives) reported **only the lines I deliberately changed** — money.js's one localized
comment and supabase.js's corrected import. Worth keeping: it is how a silent drop gets *found* rather
than hoped against.

**Localization:** every new string checked — the consolidated invoice, the forget questions, the refund
card. All generic; the only "bakery" strings left are internal identifiers (`bakeryName`) and SQL
comments.

**⚠️ Re-run `supabase/receipts.sql`** — the refund now sends an amount, and until it is run **the refund
press does not work**.

## Engine v368 → v369 — the contrast fix, and two colours the shop never declared (8 Oct 2026)

Base `47584d2` → `b400046`. 6 files, **0 conflicts**, engine **v369**, suite **3021 → 3026 pass / 0
fail**. No SQL, nothing to deploy.

**Adopted:** `admin/css/app.css` and `store/app.css` colour substitutions — the backoffice now meets
its own 4.5:1 floor everywhere (the Ingredients empty-state line, the promo badge, the engine pill and
promo chips, the Production/Scenario chips, the wish-list link); the shop's **three quiet lines** now
use `--muted` like everything else instead of hand-written greys (the tracking step labels, the line
naming the Act, and the line under Place order — the v313 fault surviving in the one file v313 did not
cover). The brand terracotta is unchanged as a fill; **eighteen places that drew TEXT in the brand
fill colour now use the text token** (white on the fill is 4.48:1 — the one pair deliberately left
under the floor).

**⚠️⚠️ AND JERKY CAUGHT WHAT THE BAKERY'S OWN TEST DID NOT.** The bakery's fix rewrote two shop rules
to `var(--amber)` — **and neither stylesheet declares `--amber`.** With no fallback the declaration is
invalid, so the tracked order's current step label and its skipped-step cross took the inherited
colour. `store/app.css` also read `var(--green, #6b8f4e)`: a fallback, so it *looked* deliberate —
and `#6b8f4e` measures **3.65:1** on the shop's surface, below the floor this very change is about.

Fixed by **declaring both tokens in the shop's `:root`, at the backoffice's own values**
(`--amber: #975a13`, `--green: #3b7449`), and **removing the `--green` fallbacks** — a fallback is not
a defence; it only hides that nobody chose the value there. Verified in the browser: the day-you-can-
order number and the chosen day's disc now render `rgb(59,116,73)`, and the three shop lines render
`--muted`.

**The guard, widened — the part that matters.** `test/readable-quiet-line.test.js`'s
"only another document declares" test searched for **one token by name** (`--terra`), so a second one
walked past it. New test: **no stylesheet may read a palette token that only its SIBLING declares** —
deliberately narrow, because both sheets also set custom properties at *runtime* (`--depth`, `--gr`,
`--tick-w`) which are declared in neither file and must not fail. **Bitten:** removing `--amber` from
the shop fails it by name.

## Engine v364 → v368 (8 Oct 2026)

Base `0e4f836` → `47584d2`. 19 files, ~1,556 insertions. **One source conflict** (`app.js`: jerky's
`renderGuide` import against the bakery's `renderReceiptRegister` — **kept both**), and the whole
batch is green: suite **2941 → 3021 pass / 0 fail**.

**Adopted:** `admin/js/views/receipt_register.js` + the `/receipts` route + its More → Money entry
(v366); `supabase/receipts.sql`'s **advisory-lock fix** — `nextval` ran before the insert knew whether
the row would land, so a lost race **skipped a receipt number**, in a run whose whole point is that it
has none (v366); v365's receipt status wording; **v367's clear-the-book** (`appliedCreditIds`,
`clearableCredits`, `clearableTotal`, `removeClearableCredits` in `admin/js/referrals.js`, plus the
danger-styled card in `admin/js/views/referrals.js` — it removes only coupons on **no live order**,
because a coupon already coming off an order *is* that order's discount and deleting it would put the
customer's price back up); and **v368's `test/screens-smoke.test.js`**.

**⚠️ THE SMOKE PASS FOUND A REAL GAP IN JERKY — its own route table.** It reads `app.js`'s routes and
fails by name for any screen it does not cover. Jerky's **`/guide`** is not in the bakery's list (the
bakery has no guide), so it failed immediately. Added to both `SCREENS` and `VIEW_FILES`.

**⚠️ AND IT INVENTED ONE FAULT, WHICH I FIXED IN THE HARNESS, NOT THE APP.** The pass reported the
Guide as throwing on a fresh install: *"document.createDocumentFragment is not a function"*. Its
stand-in lacks a method **every real page has**, and the Guide's `boldify()` uses it. Added to the
shim — the bakery's own v368 body makes the same point: *"a harness that cannot express what a screen
does invents faults."*

**Two same-basename collisions cost real time.** `admin/js/referrals.js` and
`admin/js/views/referrals.js` share a basename, and a loop that named its temp files by `basename`
wrote one file's merge over the other's — twice, and the second time it re-merged *already-merged*
files. **CARRY IT: key temp files by index, not by basename.** The files were restored from HEAD and
the pass redone.

**Localization:** the register and the receipt status said *"the bakery's records"* — changed to
*jerky's own words* ("Reading your receipt numbers…", "…could not be drawn from your receipt
register"), with the assertion in `test/receipts.test.js` moved with it.

**⚠️ Re-run `supabase/receipts.sql`** — it changed. (`tracking.sql` from the previous update is still
required if it has not been run.)

## Engine v344 → v364 — twenty versions, and the sync that carried an identity across (8 Oct 2026)

Base bakery `d47248b` (v344, exactly where jerky sat) → `0e4f836` (v364). **37 files, ~3,232
insertions.** `git merge-file -p --diff3` per file; only **7 conflicts** (bom.js 1, supabase.js 4,
store-lang.js 2) plus 15 in the test files. Suite **2901 → 2941 pass / 0 fail**.

**The three versions that travelled the other way.** The bakery's v362 (the day's count), v363 (an
order thrown away over one line) and v364 (the app says so) are its ports of *jerky's* 7 Oct fixes —
its commit messages name the munchies bridge note. Two consequences:

- **v362 kept the by-id counter; jerky keeps the by-date one.** The bakery fixed `capacityStatus` to
  `totalUnitsOnDate(state, id)`; jerky already had `bookedUnitsOnDate(state, dateStr)`. Resolution:
  jerky's hunk wins, and the bakery's *other* bom.js change (a **warning when a product has no
  recipe**, so a line is never silently uncosted) is adopted.
- **v364 closes the hole jerky left open** — "an order where NO line matches still waits forever,
  silently". Its `stuckOrders()` / `whyUnimportable()` / `forgetStuckOrders()` are adopted whole, and
  the amber notice on the Orders screen comes with them.

**⚠️ SILENT-DROP TRAP #1 — the security fix's column list.** v345 moves the customer's track lookup
out of PostgREST and into a `SECURITY DEFINER` function, because the table's `for select to anon
using (true)` policy exposed **every customer's name, address and the driver's phone** to anyone
holding the (public) anon key. The shop's `select=` list disappears — the columns now live in
`supabase/tracking.sql`'s `returns table (…)`. **The bakery's list does not contain
`postage_quoted`**, jerky's own column. Adopted as-is, the customer's card would have lost the line
telling them the posting cost is still to be quoted — silently, with nothing going red. **Added to
both halves of the function** (a `returns table` list and its SELECT are positional).

**⚠️ SILENT-DROP TRAP #2 — an identity is not engine content.** v346 fixes the *bakery's* shop
fallback number, changing `store/config.js`'s `whatsapp` from the placeholder `60123456789` to the
bakery's real number. That line merged with **no conflict** — jerky's file held the identical
placeholder — so the bakery's phone number landed in jerky's shop, i.e. the number a customer is
handed at the one moment the published settings cannot be reached. **Jerky's is `60189136389`.** This
is the class CLAUDE.md names ("never the bakery's CNAME, its Supabase project or its seed data") and
the merge could not have caught it by itself.

**⚠️ CORRECTION TO A PREVIOUS CLAIM.** The 7 Oct note to the bakery said its `productRemaining` /
`poolRemaining` carried the same by-id fault. It does not: **both apps merge two `deliveryDates`
records for the same day at load** (bakery state.js:654, jerky state.js:665), so a day has one record
and the two sides cannot disagree there. Jerky's widening is still the right rule and is kept, but it
was not a live divergence on either side. The bridge note has been corrected.

**Also adopted:** `admin/js/receipts.js` + `supabase/receipts.sql` (v360/v361 — serial receipt
numbers, refund/undo via two RPCs); the shop's privacy notice (v348–v357, all three languages, its
copy localized — *"To post it we also need…"*, *"the postal service is given…"*, where the bakery has
"the driver"); v347's config comment; v358/v359.

**Localization:** the privacy keys are jerky's, in all three languages; the authored English in
`store/index.html` is kept in step with the dictionary (the i18n test compares the two).

**⚠️ New SQL, and one of them is not optional before deploying:** `supabase/receipts.sql` (new) and
`supabase/tracking.sql` (changed — until it is run, the customer's track page does not work at all).
A push runs no SQL.

## A customer's order can no longer be thrown away (7 Oct 2026, no engine bump)

Found by asking her database whether a shop order was sitting unaccepted — there was one, from
**2026-10-07 14:25**, for the 9th: `Chicken Jerky (Taster)`, `Pork Jerky (Taster)`, `Pork Jerky`.

`importable()` (`admin/js/supabase.js`) required **every** line to match an `active` product
(`.every(...)`). She had paused `Chicken Jerky (Taster)`, so the whole order was refused — and
refused silently and permanently: the row keeps `status='new'` and retries forever. The shop's
trigger had already decremented its counts, so **the shop and the app disagreed, with a customer's
order invisible in between** — which is exactly the fault she reported.

**The fix.** `importable()` now asks for **at least one** line (`some(...)`); an order with nothing
she sells still waits rather than being claimed. `importIncoming()` collects the lines it couldn't
take (`droppedLines` — **not `dropped`**: that name is already a pin-binding in the same block, and
reusing it is a TDZ crash), and writes them onto the first created order's `note` with quantity **and
price**, because the app computes its total from the lines it holds and a note without the price
leaves her looking at a figure the customer never paid.

**Tests** (`test/supabase.test.js`, 2 new; suite **2901**): the gate accepts a partly-matchable order
and refuses one with no matchable line; and `pullIncoming` takes in the two sellable items, notes the
third with its price. **Bitten:** `.every(...)` restored fails both.

**What this does NOT yet do:** an order where *no* line matches still waits forever, still silently.
Narrow (lines come from her own published menu), and recorded rather than papered over.

## The shop and the app agree on how full a day is (7 Oct 2026, no engine bump)

Her report: *"the 9th at store show qty and the app shown qty are different"* — and she was right.
The same number was computed **three times**: what the shop publishes as `slots_left`, the Orders
calendar's chip, and the Delivery Dates card. **Two of the three were wrong in the same direction.**

**1 · The chip read a costing function.** `capacityStatus` summed a day's orders with
`explodeBom().totalUnits`, which was written for COSTING — and it **`continue`s past an order whose
product is gone, or whose product carries no `recipe` array** (it only pushes a warning). So a day with
a real order on it drew as **`0/12`** while the shop correctly showed it booked.

**2 · One record instead of the day.** Both by-id sums counted a single `deliveryDates` record, while
`computeSlots` sums every record carrying that date — so two records sharing a day disagreed with the
cell she had tapped.

**The fix — one answer, three readers.** New `bookedUnitsOnDate(state, dateStr)` in
`admin/js/bom.js`: every order for that date, across every record carrying it, whoever it is for.
`capacityStatus` and `deliveries.js` drop their own sums and read it; `computeSlots` stops using its
private `totalUnitsOnDate` (now deleted). **`explodeBom` itself is untouched** — it is still the
costing path, and `explodePoDates`/`po.js` still read it.

**The one sanctioned difference, now pinned by a test:** an over-booked day shows **negative** on the
chip (information she needs) and **0** on the shop (a customer is never shown minus two left).

**The product stamp — the same reading, fixed after her second report.** `productRemaining` and
`poolRemaining` (`admin/js/bom.js`) also took a single `deliveryDateId` and filtered orders by it,
while `computeProductSlots` sums the pool across every record carrying the date. Both now widen to the
day through a private `idsForDateOf`, and `computeProductSlots` calls `poolRemaining` **once per date**
(the old loop over `ids` would double-count now that the function itself spans the day). The orphan
fallback is deliberate: when the record is gone — an order left by a deleted delivery day — the id is
matched on its own, so such an order keeps counting as itself.

**Proof.** `test/availability-agrees.test.js` — 10 tests, one per shape. **Bitten three times:**
reverting `capacityStatus` fails the day shapes, reverting the day-widening in `productRemaining`
fails the product shape, and restoring the per-id loop in `computeProductSlots` fails the product and
pack shapes. Reverting
`capacityStatus` to the old line fails exactly the three divergent shapes** (no-recipe product,
deleted product, duplicate record) and leaves the agreeing ones green. Verified in a real browser at
375 px: a seeded day with one 3-unit order for a recipe-less product now reads **`3/12`** on the
calendar chip (it read `0/12` before).

## One version: housekeeping, a dead line removed (v344)

Bakery `562ccb2` (v343 — exactly where jerky sat) → `d47248b` (v344), the same one-file three-way
merge. **Two source files, one conflict each.** Suite **2886 pass / 0 fail** (unchanged, as the bakery
intended). **No SQL, no deploy.**

The pickup reminder still held a branch reading *"Packed and will be sent for delivery on the day"* —
**unreachable by any order** since v340, when a posted customer stopped being told anything at Packed
at all, and it also named a day the last batch had spent a day removing from every other surface. It
is deleted rather than left as a trap for whoever reads the file next.

**The test that pinned that dead branch was replaced, not deleted with it** — an assertion on a branch
no order could reach would have left the rule unguarded. It became *"the pickup reminder never says an
order is being sent"*, the invariant the old wording broke. **Localized:** the guard's pattern gained
jerky's own phrasing (`posted to you`, not only `sent for delivery`), and the kitchen's line keeps
jerky's word — **"ready for collection"**.

⚠️ **One merge trap, caught by the suite:** the conflict block's jerky side ran on into the *opening
lines of the next test*, so resolving it swallowed that test entirely (2886 → 2885). It was restored
from the original and the count is back. **Check the test COUNT after a merge, not only the pass/fail.**

## Seven versions: the van's own day, and a signpost guard (v337–v343)

Bakery `0648029` (v336 — exactly where jerky sat) → `562ccb2` (v343), the same one-file three-way
merge. **40 files, ~1,554 insertions, no SQL.** Suite **2854 → 2886 pass / 0 fail** (the new
`test/screen-names.test.js` plus the ported assertions).

**⚠️ THE ONE THING THIS SYNC IS ABOUT: the bakery RENAMED its day to "bake day" in v337, and jerky
did NOT follow.** jerky's admin keeps **"delivery date"** and its storefront keeps **"posting day"**.
The rename swept 22 bakery files; every jerky string it touched was put back to jerky's own word —
`app.js`'s route title, the More row (which also moved to **The shop** in v339), the Orders calendar's
answer, the PO's ticks, the products' hint, the Settings card, and the customer message's day label
(**"Posting day:"**, never "Baking day"). **The Production line's bakery vocabulary is untouched on
purpose** (`production.js`, `scenario.js`, the Guide's explanation of it).

**v337's real repair did come across.** A posted order's confirmation announced the *posting* day as
`Delivery: Wed, 7 Oct` while the van might be Thursday morning — which is why a customer had to ask
which day it was. The message now says the two apart: **`Posting day: Wed, 7 Oct - Post (nationwide)`**,
with the van's window on **its own line** (or the promise that it is coming), and a **collection**
order unchanged.

**v338–v343** — the van gets **its own day and time** on the order (`courierDay`, typed by hand) and
`dayLine`/`vanLine` are the ONE functions all four messages read; **a courier order is told nothing at
Packed** (nothing has left yet, so "on its way" would be untrue and its share link premature — the
button belongs to Collected / Posted); **a pickup time is not a promise**; the run's warning opens the
order; **a run is on the day the van comes**.

**Two new guards, both jerky-localized:**

- **`test/screen-names.test.js`** — every **"More → X"** in `admin/js` checked against the names that
  really exist (route titles, menu rows, group headings, all read from jerky's own files). **It caught
  five stale signposts in this app's own Guide on its first run** — `"More → Backups"`,
  `"More → About"` (neither exists as a screen any more) and three that ran on into prose — and the
  prose was fixed rather than the guard loosened.
- **`.nojekyll`** — GitHub Pages no longer runs Jekyll over the site.

## One version: your own reward coupon comes off your order (v336)

Bakery `a76d8f0` (v335 — exactly where jerky sat) → `0648029` (v336). **All five source files merged
with 0 conflicts** (`courier.js`, `referrals.js`, `invoice.js`, `views/orders.js`, `version.js`); the
eight conflicts were test assertions gaining the new field. **No SQL** — the tracking row is untouched.
Suite **2851 → 2854 pass / 0 fail**, and the new press-everything pass walked the change green.

**Her report:** *"when i refer a friend and get a coupon, but redeem that coupon will not reduce my
order price"* — and she was right.

**There are two kinds of coupon and only one was ever read.** `friendOff` is the FRIEND's: earned and
spent on the same order, so its `orderCode` *is* that order. `reward` is **the referrer's own** —
earned on the friend's order and spent on one of her own, later — so its `orderCode` names the order
that EARNED it and could never match the order it was spent on. `couponOn` matched
`role === "friendOff"` alone, so her reward coupon was **offered on her order, pressed, and marked
used — while coming off nothing**, and the toast said "already taken off this order". That is the
"the customer was promised and never saw it" shape, still live on the other half.

**The fix, in three parts:** `markOneUsed(state, whatsapp, now, appliedTo)` records **which order** the
coupon was spent on — `appliedTo` is a **new field, and `orderCode` is never overwritten** (it still
names the earning order). `couponOn` now judges by role *and* lifetime. And the receipt and the
customer's card read `couponRole`, which is why the tests gained it.

## Five versions, and the app now checks itself (v331–v335)

Bakery `7a71894` (v330 — exactly where jerky sat) → `a76d8f0` (v335), the same one-file three-way
merge. **Taken as the FINAL state of each file, never replayed version by version** — the bakery's
own brief says why: `admin/js/views/orders.js` changed in v326, v327, v332 *and* v333 in one day, so
replaying the steps in order fights itself. All four merged files came in with **0 conflicts**.

**v331 — a code search finds that order and no others.** The digits fallback meant for a phone number
typed with separators was firing on an **order code**: `C2FDA5` carries two digits, so stripping the
letters gave `"25"` and the query matched every order whose WhatsApp number contains `25` —
seventeen, on her. The fix is one line: **a query with a letter in it is not a phone number.** Tested
two-sided (the code case *and* the phone-number cases in one test), because a fix for a false match is
exactly what quietly removes a true one.

**v332 — an order with no delivery day can be opened, and a searched order removed.** Two of her
reports, one dead end from two sides: an **orphan** — an order whose delivery day she deleted, which
the app promised to keep — was drawn as a bare `<span>` with only a ✕, so the one thing she could do
with a real sale was delete it; and a finder result carried no controls at all. Now an orphan opens
its own Edit card (where the delivery-day calendar puts it back), and every finder result carries the
inbox's own remove ✕. **She was asked first** — "clear it for me" means deleting sales records — and
chose to open each one. **Never bulk-delete an order she can still be paid for.**

**v333 — the remove button added in v332 did not work.** It was written with the inbox's own variable
name (`g`) where the finder row's parameter is `group`, so pressing it threw `ReferenceError: g is not
defined` and removed nothing.

## ★ The self-check: `test/press-everything.test.js` (v334–v335, ported here)

She asked the bakery session *"you work is not checked, how can you improve?"* — and the answer was
built: **a pass that renders every route in `app.js`** (read out of its own route table and import
block, so a new screen is covered the moment it is routed), **presses every button, link, dropdown and
tick box on each — each from a fresh state and a fresh render — types into every text box, and presses
whatever a press reveals**, in the pop-up layers *and* in the screen. Anything thrown is a failure,
and it names the screen, the control, and what it was doing.

**In jerky: 26 screens, 6,046 presses, ~5 seconds, no skipped screens.**

**Four things it costs to get right**, all reproduced here rather than taken on trust:

- **A reveal is not only a pop-up.** The bakery's first pass re-scanned only the layers and **stayed
  green with a real fault put back**, because the broken button lived on a row revealed *in the
  screen* by typing into the finder.
- **Tick boxes, number boxes, and screens that fill themselves from a fetch.** Blinding this pass to
  tick boxes drops it **6,046 → 4,824 presses** and makes the whole **Purchase Order** screen read as
  having nothing to press; removing its one-turn wait makes **Reviews** read as empty.
- **`unref()` every timer a press starts**, or `node --test` reports a TIMEOUT for a pass that already
  finished — and the pass's own wait must use the **real** timer, since awaiting an unref'd one never
  resolves.
- **★ AND BITE IT.** A check nobody has bitten is a check nobody knows works. Here the v332-shape fault
  was put back (`group` → `g` in the finder's ✕) and the pass caught it by name:

  ```
  /orders  revealed → BUTTON "✕" (after INPUT "Find an order — name, #code, phone…")
      g is not defined
  ```

  A second bite (the inbox's own ✕) proved the inbox rows are walked too — the pass named it on both
  the direct press and the revealed path.

**What it is not, said plainly:** a shim is not a browser. It catches a control that breaks when used,
never whether a thing looks right or moves. **A floor, not a proof.**

## Seventeen versions in one pass: bring-a-friend becomes a coupon, and the shop's offers scroll (v314–v330)

Bakery `3073714` (v313 — exactly where jerky sat) → `7a71894` (v330), the same one-file three-way
merge. **37 files, 2,981 insertions, 4 new files** (`admin/js/views/referrals.js`, `message_style.js`,
`send_van.js`, `test/bring-friend.test.js`). **No SQL, no Edge Function.** Suite **2801 → 2846
pass / 0 fail**.

**Bring-a-friend (v314, v322–v323, v330).** The scheme left Settings for a screen of its own,
**`#/bring-a-friend`**, beside Promo codes under The shop — it is a customer offer, not a default —
and the reward is now a **coupon**: one per friend, one per order, and its words say so in all three
languages. The complaint it answers is that **the discount was promised and never seen taken**: the
friend's RM3 now comes off the customers' totals and is **named on the tracking card** (one discount
column, code or friend, never both) and in the Edit card's working.

**The shop's offer line (v316–v321, v309's line).** It **scrolls** now instead of turning — each
offer in its own box, held **2 seconds**, the next sliding up as the last leaves — so two offers are
briefly visible together, which is what makes it read as a scroll rather than a swap. Three faults
came out of it and are fixed: **a finger could stop it for good** (a clock, not the pointer), the
**"following" message was broken on a two-offer shop**, and **the Mac asked for no animation** — the
preference was being read as "off" rather than "no motion".

**Two more cards left Settings (v315):** the courier card became **`#/send-van`** (Send a van), and
the message style became **`#/message-style`**; the mailing card was renamed **"Your address"**,
because four things read it (a parcel label, the courier's door, an invoice's letterhead, the
wish-list from line) and a courier name would have her looking under deliveries.

**v324–v329:** a tracked order **stops owning the page** (and a stray customer can be forgotten), the
friend's number **comes off** the new customer's address, a day you tap **is** the day you get, the
day **stays put** when the screen rebuilds, and a day that will not open now **says why** — with the
actual cause found in v329.

**Localization.** jerky's Settings keeps its own **postageCard** (the bakery has none) and its old
`Mailing labels (post)` card was removed as the head's renamed card replaced it; `customerTotal` in
`courier.js` keeps jerky's **flat `postage`** **and** gains the head's `coupon`; the follow-up pitch
keeps jerky's **"Feeding tip"** with the new coupon wording; `send_van.js`'s pin title → "Your
pickup pin"; the changelog entries localized (bake day → posting day, the bakery's URL → munchies).
**`test/store-i18n.test.js`'s card test was adapted**, not copied: jerky's card has no `moneyEls`, so
the assertion now checks jerky's own `promo_rm > 0 && promo_code` shape.

## One version: the small grey lines are readable (v313)

Bakery `6543ed6` (v312 — exactly where jerky sat) → `3073714` (v313), the same one-file three-way
merge. **Six files** (`admin/css/app.css`, `store/app.css`, `version.js`, `CHANGELOG.md`,
`changelog.pdf`, and a new `test/readable-quiet-line.test.js`). Suite **2798 → 2801 pass / 0 fail**.

Every **small second line** — the line under a menu row, under an order row, the hint under a box, a
collection Point's address — was drawn in one grey (`#9a8471`). Measured against the card behind it
that is **3.50:1**, under the **4.50:1** the standard asks of text, on a phone, in a kitchen, in
Malaysian daylight. It is now **`#7b6552`** in **both** stylesheets (the backoffice and the shop each
define their own `--muted`, so moving one does not move the other).

**The colour is set by the worst background it lands on, not the nicest.** The first candidate
measured 5.02:1 on a card but only **4.24:1 on `--gray-bg`**, where a used promo chip and a courier-paid
tag actually live; five more backgrounds came in between 4.27 and 4.47. The shipped value clears the
worst at **4.56:1** and reaches 5.40:1 on a card.

**A join is not text.** The 2px rule inside `h3.courier-kind` keeps the **old** value as its own token
(`--join: #9a8471`) on purpose — an edge answers to 3:1, and darkening it to the new text colour would
turn a join inside a card into another box.

**`.cal-cell.off` needed no re-derive** — its `#6b5748` was derived from the *old* muted, and the
bakery's own note at that rule says it is deliberately frozen. jerky's copy matches byte-for-byte, so
jerky's documented `.cal-cell.past`-above-`.off` source-order divergence is untouched.

## One version: the More screen grouped by the work (v312)

Bakery `c67b2d5` (v311 — exactly where jerky sat) → `6543ed6` (v312), the same one-file three-way
merge. **Eight files.** Suite **2787 → 2798 pass / 0 fail**.

Seventeen screens used to sit in **one flat list** in whatever order they were built, so a row's
neighbours told you nothing. They are now **seven headings**, in the order she reaches for them:
**Logistic** (her word — Delivery run, Delivery dates, Self collection Points, Parcel couriers),
**Products & ingredients** (Categories, Units, Ingredients), **Buying** (Purchase Order, PO history,
Suppliers), **Money** (Money, Profit), **The kitchen** (Production line, Scenario planner), **The
shop** (Promo codes, Reviews), and **Settings & this app** (Settings, the change history, the
developer rows — "About" is gone as a separate heading).

**A regroup changes the heading, never the address** — all seventeen routes are unchanged, so an old
bookmark still lands where it always did. `views/products.js` gained the same three rows
(Categories / Units / Ingredients) on the Products screen itself, since she had to leave that screen
to reach them.

**Jerky-only handling.** jerky's **📖 Guide** row has no upstream equivalent, so it was **re-homed
into the last group** ("Settings & this app") rather than dropped with the flat list — the silent-drop
trap, caught by reading the resolution rather than by the merge. Two menu descriptions were
localized for jerky ("Which days you post", "what to make"). New test: `test/more-menu.test.js`,
which walks the app's own route table against the menu so a forgotten row fails by name.

## Fourteen versions in one pass: Self collection Points, and the parcel seam (v298–v311)

Bakery `4bf08a2` (v297 — exactly where jerky sat) → `c67b2d5` (v311), ported with the same
one-file three-way merge per file. **44 files, 6,147 insertions, 15 new files. Fifteen conflicts
across eight files, every one of them localization** (`confirm.js`, `courier_job.js`, `messages.js`,
`views/more.js`, `views/orders.js`, `store-lang.js`, `store/app.js`, `store/index.html`);
`admin/js/courier_job.js`'s window helpers conflict was a **move** — they left for the new
`admin/js/time_window.js`. Suite **2664 → 2787 pass / 0 fail**.

**Self collection Points (v298–v306).** A customer can now collect from a **Point** — somewhere other
than her own kitchen — instead of having the order posted. v298 the card, v299 the shop's own list
(and the customer's whole order told one `fulfillmentText`), v300 a pin for every Point on the map,
v301–v303 the delivery run carrying Point orders (and a Point she sets up **by hand**), v304 the
**collection window** and its hours, v305 those hours on the run row, v306 the **smallest basket** a
Point will take. New: `admin/js/points.js`, `admin/js/views/points.js`, `admin/js/time_window.js`,
`admin/js/address_suggest.js`. Her term is hers — it is a **Self collection Point**, never a "pickup
point" — so the admin keeps her words while the customer-facing line stays jerky's **Collect (local)**.

**The parcel seam (v307–v308).** `admin/js/parcels.js` + `admin/js/parcels/api.js` + a **NEW Edge
Function** `supabase/functions/parcel/` (`index.ts` + `easyparcel.ts`) — every parcel carrier priced
at once through EasyParcel, with a prepaid-balance warning. **It is inert without an EasyParcel key**,
and the bakery's own owner decided **not** to sign up (only an account topped up by RM500 is
integrated), so v308 makes the block read as *off* rather than as broken. jerky's parcel feature was
deliberately built as *"a note, not a booking — no key, no wallet, no fee"*; this is what turns that
into a real price, and she has asked for it.

**v309–v311** say the two ways an order leaves apart on every card, and the address box now **says
why** it is not suggesting (rather than silently doing nothing).

**The ONE deploy step.** The new `parcel` Edge Function goes up with
`supabase functions deploy parcel --project-ref ircwozniiyywsowamixy` **from the REPO folder** (never
inside the function's folder). No new SQL, and nothing to change on the phones.

**Localization.** `fulfillmentText` in `points.js` ("Courier delivery"/"Self collect") → jerky's
**Post (nationwide)** / **Collect (local)**; `time_window.js`'s "before it left the bakery" → *"your
place"*; `views/points.js`'s **BREAD** → **TREATS**; `parcels.js`'s default parcel description
**"Baked goods"** → **"Pet treats"**; `store-lang.js` gained the Point keys in all three languages.
`home-lang.js`/`index.html` kept jerky's own homepage.

**Two merge traps, both hit.** The conflict resolver left the marker's **path line** behind in four
files (the suite caught it — they stopped parsing), and one resolver call omitted the closing marker
so `>>>>>>> …h.tmp` was left inside `views/orders.js`. Both are the same lesson: **after a merge,
parse-check every written file, never trust the resolution script.**

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
