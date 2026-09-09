# Munchies Furkidz — change history (v54 → v66)

What changed in each version of the backoffice app, newest first. Each version
number is the "Engine" you can see on the app's **More** screen, so you can
always tell which build a phone is running.

## v66 — Products that translate themselves + Draft / On the shop / Hidden (9 Sep 2026)
**Product text now translates itself into 中文 and Bahasa Malaysia.** When you
save or publish a product, the app quietly fills Chinese and Malay versions of
its name, description, selling unit and feeding tip — machine-made from your
English, free, whenever you're online. Each translated box is tagged **"auto"**.
Type over any box and it becomes yours, never overwritten again; and in
**Products → Edit** you can tap **Fill all 中文** / **Fill all Bahasa Malaysia**
to fill a whole language now, or **↻ Translate this one** for a single line. If
you later change the English, the box is re-filled to match; delete the English
and the translation is dropped. Shoppers reading in that language then see the
product in their own words on your order page.

**Products now have three states, shown as three lists** — **On the shop**
(live, orderable), **Draft — not on the shop yet** (a brand-new product starts
here, fully built but not for sale), and **Hidden — taken down** (off the menu,
history and recipe kept). Publish a draft to put it on the shop; Hide a live
product to pause it. Drafts and Hidden products never appear on the storefront
and can't be ordered, so building a new recipe can't accidentally go live.

**The "Copy follow-up" referral message now has a language choice.** In a
customer's profile, before you copy the follow-up, pick **English / 中文 / BM** —
the whole check-in (greeting, the product's translated name and feeding tip, the
scheme pitch, the link) is written in that language, ready to paste into
WhatsApp. English stays the default. No SQL this version.

## v65 — Reviews to publish, one at a time (9 Sep 2026)
**More → Reviews** now walks you through the reviews **one at a time**, drawing
each exactly as it will look on your homepage (photo, stars, message, name).
The ones waiting for you to publish come first; **Publish** puts it on the
homepage, **Take down** hides it again, **Delete** removes it for good — and
every action moves you on to the next review. It deliberately does not
auto-play, because you are deciding, not watching: the review in front of you
stays until you move it with the ‹ › arrows, the dots, or a swipe.

Two places now tell you when reviews are waiting on you: **Home** shows an
"⭐ N new review(s) to publish" card near the top (tap it straight into
Reviews), and the **⭐ Reviews** row on More gains a green "N waiting" pill.
The count refreshes every ~45 seconds while Home is open. No SQL this version.

## v64 — Your site in 中文 / English / Bahasa Malaysia + a website credit (9 Sep 2026)
Your **homepage and ordering page now speak three languages.** Tap **English /
中文 / BM** at the top of either page and every word — navigation, product
cards, the delivery-day and order form, even the track page — switches over on
the spot, and each phone remembers the language it picked. Because the choice
lives in the browser, one shop link serves every customer in their own
language. Each product can also carry a Chinese or Malay **shop name** in
Products (e.g. 鸡肉肉干 or Jerky Ayam): it shows on the product card while the
order and your records keep the English name.

The homepage **reviews** section is now a **swipeable carousel** — drag left or
right through the reviews you have published, or tap the dots — and if your
website was built for you, **Settings → Website & developer** lets you name who
made it. A small **"Website by …"** credit then appears at the bottom of your
homepage and order page, and **More → About** adds a WhatsApp and an email row
to reach them. That same developer is who the **software wish list** emails:
add a wish on More and the whole list is sent to them automatically (quietly —
if it can't send, a gentle note points you to the always-works **"✉ Email the
full list"** row underneath). The credit and the email links stay hidden until
you type a name and an email in Settings.

## v63 — Customers tab, wish list, holidays fix (8 Sep 2026)
**Customers** is a real tab of its own, swapped with **Purchase Order** (now
under **More → Purchase Order**). The tab stays your automatic customer list —
who ordered, how much, their favourite — and now every person can carry a
**profile** (the **Edit** button in their history pop-up): their pet's name and
a small photo (auto-shrunk to a thumb), what they like, what to avoid, and a
note. Profiles save into a synced `customers` collection, so both phones know
the same people, and they build up quietly for a future AI chat about your
customers. A **finder** box at the top of the tab filters the list as you type —
name, number, pet's name, likes, notes — and says how many match, just like
"Find an order" on Orders. A saved profile shows as a paw or photo beside the
name and a small line under the row.

On **Home**, the "Upcoming holidays" card is fixed: it used to vanish whenever
nothing was marked on the Delivery calendar. It is now always there — up to
three marks at a glance, a scroll for any more, and a friendly empty state that
still opens the calendar so you can add days.

On **More**, a small green **Engine v63** pill (in the header card) shows which
build this phone runs, a **Software wish list** sits at the bottom and behaves
exactly like your to-do list (add, tick, reword, remove — a tick stays ticked
and never touches the weekly routine), and **Full change history** opens this
history as a PDF kept on your website. No SQL this version.

## v62 — "Not sharing" strip + read-only View (8 Sep 2026)
When a phone is not on the shared cloud — shared data off, never set up, or
signed out — a thin amber strip at the very top of every screen reads **"⚠ Not
sharing right now"** with a one-line reason and a **Fix it** tap straight to
Settings → Shared data. It never locks the app, and it disappears on its own the
moment sharing is back on. (Set up once per phone: no SQL — the shared-data
setup you already did covers it.)

Also, every backup copy in Settings → **Backup & safety** now has a **View**
button: a purely read-only look inside that copy — its orders grouped by
delivery date (customer, product, quantity, status), the product price list and
ingredient stock at that time. Looking at a June price confirms the detail
without moving today: no rewind, nothing written, ever.

## v61 — Cloud backups (8 Sep 2026)
Every time the app opens while signed in, it quietly saves a full **Daily**
copy (first open each day), a **Weekly** copy (Mondays) and a **Monthly** copy
(the 1st) to your own Supabase cloud, keeping the newest 7 daily / 4 weekly /
3 monthly. A "Back up to cloud now" button, and one "Before restore" copy
saved before every restore, stay until you delete them. Each copy can be
**Restored** (steps the phone — and the shared cloud — back to that copy; a
"Before restore" copy is always saved first, so it is never one-way),
**Downloaded** as `furkidz-backup-YYYY-MM-DD-KIND.json` (which re-imports
like an Export), or **Deleted**. Lives under More → Settings → "Backup &
safety". The copies never contain the per-phone app-login email/password or
the app password. Setup: run `supabase/backups.sql` once.

## v60 — Homepage customer reviews (8 Sep 2026)
Customers can leave a **What customers say** review on the homepage — name,
1–5 stars, a message in English / 中文 / Bahasa Malaysia, and an optional
photo. Every review lands *unpublished* in More → Reviews, where **Publish**
shows it on the homepage, **Take down** hides it, and **Delete** removes it —
nothing becomes public until you tap Publish. Reviews appear on the homepage
only. Setup: run `supabase/reviews.sql` once.

## v59 — Occasion import tidy-up (8 Sep 2026)
Added **World Animal Day** (4 Oct) to the fun/pet-day import, plus
whole-group ticking — tick a heading box, or use **Untick all / Tick all**.

## v58 — Occasion import (8 Sep 2026)
A one-tap **＋ Add occasion** import of Malaysia's days plus fun days (pet,
people & kindness days, and more), and a **My own day** quick-add.

## v57 — Private notes per product ingredient (8 Sep 2026)
Each ingredient line in a product can carry a short private description *for
that product only* (e.g. which cut or brand of chicken that product uses).
Typed and seen on the Products screens only — never on the shop, a label, or
the product cards.

## v56 — "Keep at least" reserve (8 Sep 2026)
Ingredients can set a **Keep at least** level. The order list tops an
ingredient back up to that level in whole packs when your stock drops more
than 10% under it, and low items ride along even when today's posting run
doesn't use them. The Ingredients screen shows a red low-stock strip.

## v55 — Time & length units (7 Sep 2026)
**min/hr** and **cm/m** are pre-loaded in Units (under More), like g/kg — so
oven or dehydrator times and treat sizes can be measured and converted
(1 hr = 60 min, 1 m = 100 cm). Stock is guarded so a time or length unit can
never distort a gram count.

## v54 — Ingredients on hand (7 Sep 2026)
Ingredients now have **On hand** stock. The PO buys only what you don't have
(rows you already have drop out), "Bought" on a saved list adds its packs
once, and marking an order **Preparing** (the engine step the bakery calls
"Baked") subtracts its ingredients (undo restores them).

---

*This history covers the two-phone cloud era (v54+). Earlier versions
(pre-v54) were never recorded version by version, so they are not listed here
rather than invented. Each new version is added here as it ships.*
