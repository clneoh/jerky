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
That covers the business name, tagline, WhatsApp number and social links. The
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
- Photos upload to the public `review-photos` Storage bucket via the anon key.

**One-time setup:** run `supabase/reviews.sql` in the SQL editor (adds the
`reviews` table + RLS and the `review-photos` Storage bucket + policies).

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
  **track link**. The customer opens that link and sees the live status, their
  method/address, and the TNG QR to pay.
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
re-fetched (the menu, the "only N left" numbers, the product photos) and the
customer's basket, chosen posting day and typed details survive. `render()`
assigns a `repaintForLang` hook (tagged static HTML + title via `applyTo`,
`renderStatic`, `rerender`, `renderBar`, and the track card from its cached
`lastTrack` via `paintTrack`), and the exported `setLang(lang)` runs it and moves
the pill highlight — so a switch never re-enters `render()` and never reloads.
`i18n.js` gained an `isLang` guard. Code-only, no SQL.

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

Tests cover the pure modules (`admin/js/bom.js`, `admin/js/dates.js`), the sync
engine (`admin/js/sync.js`), the app bootstrap + sign-in gate
(`admin/js/app.js`), and the storefront (`store/app.js`).

## Files

```
changelog.pdf       full change history (every version from v54, PDF) — root of the site
index.html          public homepage (domain root) — trilingual, data-i18n tags
home.js             homepage logic: i18n apply + carousel + reviews boot (module)
home-lang.js        homepage dictionary (en / zh / ms)
i18n.js             shared language loader (LANGS, loadLang/rememberLang, applyTo)
reviews.js          homepage reviews fetch + carousel + review form (root module)
store/index.html    customer order page (/store/)
store/app.css       storefront styling
store/app.js        storefront logic + order intake + availability + published config
store/config.js     fallback name, WhatsApp, menu, days, supabase (overridden by Settings → Storefront)
store-lang.js       order-page dictionary (en / zh / ms)

admin/ — backoffice app (/admin/):
  index.html          entry (bottom nav shell)
  css/app.css         backoffice styling
  css/print.css       prints only the PO card
  js/state.js         schema, localStorage load/save, ids, formatting, order-line snapshot
  js/dates.js         posting dates, cut-off, countdown (pure)
  js/bom.js           BOM explosion, costs, capacity (pure)
  js/supabase.js      live availability + storefront config publish, order intake
  js/sync.js          shared-data sync engine (queue, pull-then-flush, conflict)
  js/backups.js       cloud backups (auto daily/weekly/monthly snapshots, restore)
  js/sharewarn.js     "Not sharing right now" amber strip (top of every screen)
  js/validate.js      import-file validation
  js/ui.js            DOM builder + shared render helpers
  js/wishlist.js      software wish list on More (lazy settings.wishList CRUD)
  js/devmail.js       builds the wish-list email + developer contact links (pure, sends via wish-mail)
  js/profiles.js      customer profiles (join to the customer rows, pure)
  js/photo.js         shrinks a picked photo to a small thumb (browser only)
  js/app.js           hash router + bootstrap + shared-data gate
  js/views/*          one module per screen (login.js is the sign-in gate)
  sw.js               service worker — offline app shell (/admin/ scope)
  manifest.webmanifest PWA manifest for the backoffice

supabase/availability.sql   run once in Supabase SQL editor (public slots)
supabase/backoffice.sql     run once in Supabase SQL editor (shared data, RLS)
supabase/backups.sql        run once in Supabase SQL editor (cloud backup snapshots, RLS)
supabase/storefront.sql     run once in Supabase SQL editor (storefront config + order intake)
supabase/reviews.sql        run once in Supabase SQL editor (homepage reviews + photo bucket)
supabase/tracking.sql       run once in Supabase SQL editor (order tracking)
supabase/functions/wish-mail  optional edge function: emails the wish list to the developer
test/               node --test suites (import from admin/js and store/)
marketing/          social-media marketing guide generator (gitignored)
```
