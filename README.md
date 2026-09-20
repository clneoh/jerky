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

## Sales codes & QR labels: shops, promotions, bring-a-friend (built here, no engine bump)

The reseller/sample programme: a shop hands a customer a free sample whose card
carries a QR, the customer scans it, lands on a branded page, and the order that
follows is attributed back to that shop. **A QR is deliberately not single-purpose** —
the same mechanism carries a product promotion and a bring-a-friend introduction, so a
new idea is a new *code*, not a change to the app. Every printed label also carries a
tiny human-readable code (`K3X9`) beside the square, so two labels can be told apart by
eye.

**Built in jerky, so `version.js` does NOT move** — the engine number describes the
*shared* engine, and the Guide screen promises both apps show the same one. The bakery
has none of this; `qr.js` and the codes model are business-neutral, so the sync playbook
could carry it there later (that would be a real engine bump).

### One code, four kinds

`admin/js/codes.js` is the model. `KINDS` are `shop` / `promo` / `intro` / `plain`,
with `kindOf(c)` defaulting an unlabelled code to `plain`; `CODE_ALPHABET`
(`23456789ABCDEFGHJKMNPQRSTUVWXYZ` — no `0`/`1`/`I`/`L`/`O`) and `CODE_LENGTH` (5) drive
`makeCode(state)`, which avoids collisions with codes already in the list. A kind decides
only what a label *says*; nothing downstream branches on it except the published record.

- `tasterUrl(code, origin)` → `<origin>/taster/?c=CODE`; `shopUrl(code, origin)` →
  `<origin>/store/?c=CODE`; `labelUrl(code, origin)` is `tasterUrl` **plus**
  `&via=<waNumber(referrerDigits)>` for an `intro` code only — which is how a
  bring-a-friend label reuses the existing `?via=` credit engine **unchanged** (it
  stamps `order.referredBy`, nothing more).
- `offerLine` / `offerText` / `offerMinText` state an offer in the same words the shop
  banner uses, so a customer meets one sentence, not two.
- `codeStats(state, code, today)` counts a code's orders and sales;
  `codeCustomers(state, code)` lists who it brought. `sheetLabels(state, codes)` builds
  the printed label sheet.
- `visitTally(rows)` → `{ total, byCode: Map, pets: {dog, cat, none} }`. A row with no
  code counts towards the total only, so a page opened without a label is still counted
  as a visit but is never attributed to a label.

### The encoder

`admin/js/qr.js` is hand-written and dependency-free — house convention: no `package.json`,
no CDN at runtime. `qrMatrix(text)` returns the boolean matrix (byte mode, ECC M,
versions 1–10); `qrSvg(matrix, options)` returns a **string**; `qrPngBytes(matrix, options)`
returns a `Uint8Array`. Both renderers take an options object (`size`, `margin`, `dark`,
`light`) and are pure — every canvas/blob call sits behind a click handler, so the ~29
test files that each re-define `createEl` inline are never asked to draw one.

### The screen

`admin/js/views/codes.js` (`#/codes`, More → **🏪 Shops & codes**) has four cards: the
landing page's own copy (English + 中文 + BM, the products pattern — type English once,
translate the rest); **Your pages** (one set of words per promotion or activity); the
**shops** (partner contact, commission rate, samples given); and the **codes**, each with
a QR preview, a PNG download, the printed label sheet, an "open what the customer sees"
link and its own counts. Two more sections follow: **Label visits** and, above them all,
a **📷 Scan a label** button.

**Landing pages: the middle layer.** `state.pages[]` (beside `state.codes`) holds one
record per activity — `{id, name, heading, headingZh, headingMs, body, bodyZh, bodyMs,
trOverride, trSrc, createdAt}`, the same six copy keys and the same translation
provenance a label or a product carries, which is what lets `isOverridden` / `markManual`
and the whole `copyLine` / `fillAll` / `regenOne` machinery work on a page with no new
translation code. A label names one with `code.pageId` (`""` = the shared page).

The three layers resolve **at publish time, inside `publishCodes`** — not at render time:

```js
const out = { code, kind };
pageLines(pageOf(state, c), out);   // layer 2: the page the label picked
pageLines(c, out);                  // layer 3: the label's own line wins
```

so the published shape is unchanged and **neither `/taster/` nor `store/app.js` needed an
edit** (`pageLines` writes only non-blank keys, so a blank line falls through rather than
blanking — and `pageId` itself is never published, so the customer's page still sees one
flat shape). `pageOf(state, code)` returns the page or **null**: a label whose page was
deleted falls back rather than breaking, which is why `codeDraft` blanks a `pageId` that
no longer resolves. `pageStats(state, pageId)` counts the labels on a page, shown on the
row and in the delete confirm. `linesFor(state, code, shared)` is the *base* — `shared`
with the page laid over it, **not** including the label's own line: it answers "what does
the page say", which is exactly what an empty box falls back to, so the greyed hint is
the line a customer would really read and a page's blank line shows the shared page's
line rather than an empty box.

`pageDraft(page)` is exported and pure for the same reason `codeDraft` is (below). A page
editor is the same `copyTarget` machinery pointed at a page record; `persist` is again a
no-op and its `redraw` writes the name box back **before** `refresh()`.

**One label's own words.** The same two lines exist twice — on the shared page, and
optionally on one label. Both are drawn by one `copyLine(target, en, label, max)` against
a small **copy target** (`{obj, shared, persist, redraw}`), so the boxes, the translating,
the `is-mine` mark and the `↻` cannot drift apart between the two places. `obj` is where
the words live (`settings.taster`, a page, or the code being edited); `shared` is the
**merged base** (`linesFor(state, draft, t)` — the shared page with the label's page over
it), shown as the **placeholder** in every empty box so a blank box visibly reads as the
line a customer will actually get; `persist` keeps what was typed — a **no-op inside the
code or page pop-up**, whose Save is the only writer; `redraw` repaints whatever holds the
boxes. `sharedHint(target, key, fallback)` resolves a hint as that base's *same language*
line, then its English, then the box's own label. Clearing a box calls `markManual` (not
`markAuto`): on a label a blank box means *"the page says this line"*, which is a
decision, so `Fill 中文 / BM` must not put a translation back into it.

The code pop-up's group is folded behind a module flag (`codeCopyOpen`, the `copyOpen`
pattern). Its `redraw` is `() => { keepTyped(); refresh(); }` — **`keepTyped()` first**,
because `showPopup`'s `refresh()` rebuilds the label and code boxes from `draft`, and
those two are only synced on a kind change and on save: a refresh without it would revert
a label she had just typed. `saveIt` deletes a blank copy key from **both** the new row
and the record it replaces — an assign only adds or overwrites, so a line she deleted
would otherwise stay on the label and still be published.

**`codeDraft(code, state, t, today)`** builds the working copy the pop-up edits, and it is
exported and pure because one rule in it is easy to get wrong and invisible when it is.
A label's `trOverride` is an **array** of variant names, so copying it with an object
spread hands back `{"0":"headingZh","1":"headingMs"}` — and `isOverridden()` only reads an
array, so **every box she had typed by hand would quietly read as machine text again and
the next `Fill 中文 / BM` would overwrite her words**. It copies with
`Array.isArray(code.trOverride) ? [...code.trOverride] : []`, and copies the offer and
`trSrc` alongside it, so nothing typed in the pop-up and then abandoned can mark the
record underneath. `test/codes-draft.test.js` holds the rule (including a record carrying
the wrong shape, which must not leak through).

Each translated box in the code pop-up also carries a visible **`.qr-trans-lang` tag**
(`中文` / `BM`). It cannot be inferred from the placeholder: on a label the placeholder is
the shared page's line for that language, so a line whose shared translation is blank would
leave the 中文 and BM boxes showing the same English. The same reason the products editor
prints a `LANG_LABEL`.

The visits card is the only card on the screen that needs Supabase, so it uses the
Reviews card's shape — `pullVisits(state)` returning `{ ok, reason, rows, capped }`, an
early return when `!ok` naming the reason plus a **Try again** button, and the unmount
hook. `VISIT_LIMIT` is 2000 rows; 404/400 means the one-time SQL has not been run.
`reviewErr(err, fallback)` surfaces a dead host's own `"Failed to fetch"` — deliberately
matching the Reviews card rather than diverging.

**Scanning** (`openScan`) offers the camera **where the browser supports it** —
`navigator.mediaDevices.getUserMedia` *and* `"BarcodeDetector" in window`, i.e. Chrome/
Edge on Android and desktop, **not iPhone Safari**. The typed box is therefore always
present beside it, never a fallback you have to find. `codeFromScan(raw)` pulls the code
out of a scanned URL's `?c=` (and accepts a bare `K3X9` if she ever prints one that way).
The popup has **no on-close hook** (`ui.js`'s `showPopup` draws its own ✕), so the camera
loop detects its own teardown by polling `video.isConnected`.

### The landing page

`taster/` is a standalone page (`index.html`, `app.js`, `app.css`, plus the root
`taster-lang.js` for its fixed chrome). It reads `?c=` and `?via=`, paints from its own
fallback copy, then `loadPublished()` fetches the **same `storefront_config` row the shop
reads** and merges `remote.taster` / `remote.codes` in — so the words are hers to change
on the Shops & codes screen with no redeploy. It states the label's offer (`offerWords`,
hidden once `to` has passed), asks dog-or-cat, records the visit, and links on to
`/store/?c=CODE` (via `storeLink`, which keeps both stamps). Its stylesheet is
self-contained but reads the store's tokens, so the two pages look like one business.
`app.css` is mobile-first: the page is almost always opened by a phone pointed at a square.

`codeCopy(shared, info)` is what makes a label's own words work: it lays the label's
non-blank `heading`/`body` (+`Zh`/`Ms`) over the shared copy and hands the result to the
same `copyFor`, so **each language falls back on its own** — a label that wrote only an
English heading still reads the shared page's Chinese line for that heading, rather than
blanking it or mixing languages. It is pure and returns a fresh object, so the shared copy
is never written through. A label with nothing of its own is therefore byte-identical to
the shared page.

Both halves of the published payload are built by `publishTaster(state)` and
`publishCodes(state, today)` in `admin/js/codes.js`, which share one private `pageLines(src,
out)` — **the same shape in both places is the whole mechanism**, because it is what lets
`codeCopy` treat an absent key as "the shared page says it". **Both are deliberately
narrow** — a customer may see a code, what it offers, the shop's *name* and those two
lines, never its WhatsApp number, commission or notes.

### The order chain

`store/app.js` gains `parseCode`/`currentCode`/`codeInfo` beside the existing `?via=`
pair, `renderCodeBanner(cfg)` (a `#code-banner` in `store/index.html` beside the referral
banner, which **blanks as well as hides** so a stale code's words cannot linger), and the
stamp at order build: `order.promoCode` + `order.codeKind`, **only when the code really
is one the app published** — a made-up `?c=` must not land in the books as a label that
never existed. Only the code and its kind travel; the shop behind it is read back from
the record, so a renamed shop is named right everywhere.

`admin/js/supabase.js`'s `importIncoming` then carries `promoCode` and `codeKind`
**through the whitelist** — without that the stamp is silently dropped and every code
would report zero forever. **No SQL is needed for the stamp**: `incoming_orders` is
`(id, data text, status, created_at)`, so the whole order rides as one JSON blob and a
new field costs nothing (`referredBy` works the same way).

### The one SQL she runs

`supabase/taster_visits.sql` — one small table (`code` ≤16 chars, `pet` in `''`/`dog`/
`cat`, `lang` in `en`/`zh`/`ms`) with **RLS on, an anon INSERT policy only and an
authenticated SELECT policy only**. That asymmetry is the whole privacy story: the public
page can add a visit and nobody anonymous can read one back, while the admin sends a
Bearer token (`reviewAuth`) and sees the counts. Until she runs it, labels print and scan
normally and only the counts are missing — the card says so instead of going blank.

### State & sync

`state.partners[]`, `state.codes[]` and `state.pages[]` are new lists (all three in
`sync.js`'s `LISTS` so her two phones agree — a label points at a page by id, so the page
has to exist on both phones or the label silently reads the shared page on the one that
never got it), and `state.settings.taster` rides the `recordPayload("settings")`
whitelist with the same gated spread the `tasks` entry uses. **All of them must be in
`state.js`'s `normalize()` or they are dropped on load.** `isNewCustomer(state, group)`
generalises `referralFlag` — "new" is the same thing she described: a WhatsApp number
that has never bought before — and backs every code marked `newOnly`.

**The money stays hers, deliberately.** The shop never computes a discount: it freezes
`lines[].price` and the admin stamps it as `unitPrice`, which Money and Profit read. A
silent storefront discount would rewrite recorded revenue and profit. So the landing page
and the shop banner *state* the offer and the admin *tells her what to apply* when she
confirms on WhatsApp — exactly how the existing referral credit works.

### A customer puts the code in themselves

`#code-section` in `store/index.html` is a **"Have a code?"** box on every visit, even to
a customer who arrived on a label's own link. `currentCode()` splits into two readers:

```js
export function boxCode() {          // what the customer typed, or ""
  const box = document.getElementById("code-input");
  return box && box.value != null ? String(box.value).trim().toUpperCase() : "";
}
export function urlCode() {          // what the printed label's link carried
  return location.search ? parseCode(location.search) : "";
}
export function currentCode() { return boxCode() || urlCode(); }
```

**Box wins over URL**, so typing *replaces* the label's code and clearing the box and
pressing Apply puts it back. The three readers — the banner, the note and the order stamp —
all go through `currentCode()`, so they can never disagree.

The distinction that matters is **whether the box holds anything**, not whether it differs
from the link: `renderCodeNote`'s `typed` test is `boxCode() !== ""`. Typing the label's own
code in is still the customer asking a question, and still deserves the answer a silent
scan does not need. A code the app never published stays silent when it came from the link
(the label is already in someone's hand) and is answered when it was typed —
`codeUnknown`. The stamp keeps its `if (usedInfo)` gate, so a made-up code still lands
nowhere.

`wireCodeBox()` copies `wireTrack()` exactly: click handler plus Enter on the box, and
**deliberately no `input` or `blur` handler** — a half-typed code matches nothing, and a
customer half-way through typing must not be told they are wrong because they tapped a
product.

### The note under the offer

`liveCodeOffer(info, today)` is shared by the banner and the note, so an offer that has run
out goes quiet in both. `renderCodeNote(cfg, total)` then says one of four things, and takes
`total` from `renderBar`'s own hoisted `basketTotal()` — never a fresh sum, so the note can
never contradict the number on screen. The note prints the **offer** and the **shortfall**
(`codeNoteAdd`, the only subtraction the page ever makes) and never the computed discount: a
"RM2.20 off" the customer read would be a figure she then has to honour on a basket they may
still edit. `newOnly` is restated nowhere here — the shop cannot check it and must not imply
that it did.

### What the order tells her

`promoOf(state, group, today, total)` in `admin/js/codes.js` is the pure resolver behind the
🎟 line; `promoBlockEl` in `admin/js/views/orders.js` renders it, on the order row **and**
in the Edit pop-up. Two design points carry it:

- **The code is resolved live through `findCode`**, never denormalised onto the order — an
  order carries only `promoCode` + `codeKind`, so a label renamed later reads right here and a
  code she has since deleted still leaves the kind the order recorded. The name is the label's
  own (`codeLabel` — her label, else the code): a code record keeps only the *ids* of the shop
  and product it was made for, whose names are written onto the published payload for the
  customer's page and never stored, so naming them from here would read a shape the app does
  not write.
- **`overMin` and `newCustomer` read `true` when they do not apply**, so the view only ever
  tests for a *warning*. `newCustomer` is the whole reason validation splits: "new customers
  only" needs every other order in the book, which only the admin has. A number-less order
  gets no verdict at all (`keyable`) rather than the wrong one — a warning she cannot act on
  is worse than none.

The pop-up passes `paintTotal`'s own sum as the fourth argument, which is why `total` exists:
mid-edit, a minimum warning measured off the saved items would disagree with the "Order
total:" line directly above it, and it tracks a `+`/`−` tap live.

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

**Sales codes** publish the narrow half of a label to the storefront config: the
code, its kind, the offer and the shop's **name** — never a shop's WhatsApp number,
its commission rate or her notes about it. **Label visits** (`taster_visits`) are
deliberately one-way: **anon may INSERT and nothing else**, and only an authenticated
read returns rows — so a customer's page can add a visit and nobody anonymous can read
one back, while her own phones (which send a Bearer token) see the counts. The landing
page holds no account and no cookie; it records only the code, the pet and the language.

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
store-lang.js       order-page dictionary (en / zh / ms)
taster-lang.js      landing-page dictionary (en / zh / ms) — its heading/body come from the shared copy instead
taster/index.html   the page a printed label's QR opens (/taster/?c=CODE)
taster/app.js       landing page: ?c= / ?via=, published copy, the offer, dog-or-cat, the visit
taster/app.css      landing-page styling (self-contained; reads the store's tokens)

admin/ — backoffice app (/admin/):
  index.html          entry (bottom nav shell)
  css/app.css         backoffice styling
  css/print.css       prints only the PO card
  js/state.js         schema, localStorage load/save, ids, formatting, order-line snapshot
  js/dates.js         posting dates, cut-off, countdown (pure)
  js/qr.js            QR encoder — matrix / SVG string / PNG bytes, no DOM, no deps (pure)
  js/codes.js         sales codes: kinds, makeCode, the URLs, the offer sentence,
                      the landing-page layer (pageOf / pageStats / linesFor),
                      the published half (publishCodes / publishTaster), visitTally (pure)
  js/money.js         what came in — cash / TNG / still to collect (pure)
  js/courier.js       the courier charge, who bore it, and the customer's total —
                      the flat postage it replaces, the COD split, apply / clear (pure)
  js/profit.js        the books — sales, cost of sales, running costs, capital / drawings (pure)
  js/accounts.js      the categories and ways to pay the books read, and their built-in defaults (pure)
  js/bom.js           BOM explosion, costs, capacity (pure)
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
supabase/taster_visits.sql  run once — one table for label visits; anon INSERT only, authenticated SELECT only
supabase/functions/wish-mail  optional edge function: emails the wish list to the developer
test/               node --test suites (import from admin/js and store/)
marketing/          social-media marketing guide generator (gitignored)
```
