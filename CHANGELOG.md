# Munchies Furkidz — change history (v54 → v72)

What changed in each version of the backoffice app, newest first. Each version
number is the "Engine" you can see on the app's **More** screen, so you can
always tell which build a phone is running.

**10 Sep 2026 — the back-office link is off the homepage (no new engine; the
phones did not change).** The homepage footer carried a small "Back-office
login" line — the only public link to your app anywhere on the site — and it has
been removed, so nothing on your public pages now points at `/admin/`. You open
the app exactly as before: the **Home Screen icon** on your phone (open
`munchies.com.my/admin/` once in Safari, Share → Add to Home Screen), and the
login itself is unchanged — it still asks for your 4-digit PIN and your sign-in.
The WhatsApp number under the footer link now also writes itself the Malaysian
way (**+60 18-913 6389**) whatever you type in Settings, and it still follows
**Settings → Storefront** like the rest of the footer.

**10 Sep 2026 — the app can no longer be handed a web page where it asked for a
script (no new engine; the phones did not change).** So the app can open without
a connection, it keeps a background copy of itself. Whenever a file failed to
download, that copy used to answer with the app's own **web page** — even when
what had failed was a **script** or a **picture**. A browser handed a web page
where it asked for a script cannot run the script, so whatever that script was
meant to set up would quietly stop working, with nothing on screen to explain
why. Now only a real page — opening or refreshing the app — may fall back to the
stored copy; a script, a stylesheet or an image that fails simply fails, so a
fault shows itself as a fault instead of hiding behind a page. Opening the app
offline still works exactly as before. Your website has always run its app from
`/admin/`, so it never had the leftover copy that caused the visible version of
this fault elsewhere; the guard is in for good anyway, so it cannot start here.

**10 Sep 2026 — the homepage's contact details now follow your Storefront
settings (no new engine; the phones did not change).** The WhatsApp number,
Instagram and Facebook links in your homepage footer were typed into the page
itself, so changing them under **Settings → Storefront** moved your order page
and left the homepage still showing the old ones. The homepage now reads the
same published settings as the order page, so the two always quote the same
number and the same handles. Leave a box blank and the homepage keeps the link
it already has, so an empty box never breaks a working link. (The homepage's
contact **email** has no Settings box behind it — tell me if you want one.)

**10 Sep 2026 — review photos load one at a time on the homepage (no new engine;
the phones did not change).** The **What customers say** section on your homepage
used to fetch **every published review photo up front** — including the reviews a
visitor never waited around to see. A photo is now fetched **as its review comes
around**, one step ahead of time so it is ready before it slides in, and the
reviews a visitor never reaches are never downloaded at all. On a phone that
means less data and a quicker page, and it changes nothing about how the section
looks or behaves.

A review photo is also shrunk a little harder before it is stored — to 1000
pixels across instead of 1600. The card on the homepage shows a picture no more
than 340 pixels high, so the smaller copy looks just as sharp while being about
**a third of the size**, which is kinder to the customer's mobile data and keeps
your stored photos light. This applies to photos left from now on; the reviews
already on your page keep the picture they were stored with. (Your homepage
itself already loads its pictures as separate files — its page is only about
29 KB — so nothing needed changing there.)

## v72 — A sold-out note reads in the customer's language (10 Sep 2026)
Your order page switches language the moment a customer taps it, but two corners
of it had stayed English whichever language they chose: the short note on a
product that **cannot be ordered for the posting day they picked** (that it only
opens from a certain date, only runs up to one, or that orders close so many days
ahead — with the date written in the page's language), and the notes that appear
above the menu when the page **has to change a basket** — something that just
sold out, or a quantity trimmed to what is actually left.

Both now read in **English / 中文 / BM** along with everything else. The reason a
product is closed is handed to the page as a plain fact — which kind of rule, and
the day or number of days behind it — and the page writes the sentence itself, so
no English can slip into a Chinese or Malay page. An English visit reads word for
word as it did. Engine v72, guide v72.

## v71 — The order page's 中文 / BM buttons answer instantly (10 Sep 2026)
On your order page, tapping **EN / 中文 / BM** used to reload the whole page. That
re-downloaded the page and fetched the menu, the "only N left" numbers and your
saved order-page settings all over again, so each tap sat there for a moment
before anything changed — and the slower the customer's connection, the longer
the wait. A reload could also wipe a basket that was already half filled.

Now the order page switches **in place**, exactly like your homepage already did:
the words change the moment they tap, and nothing is downloaded again. Whatever
the customer has already done is left exactly as it was — the items in their
basket, the posting day they picked, the name, WhatsApp number and postal address
they typed — and if they are looking up an order, that card re-reads in the new
language too. Nothing to set up.

## v70 — An order keeps the name and price it was sold at (10 Sep 2026)
Until now an order did not remember what it was sold as — it just looked the
product up afresh each time it was shown. So if you renamed a product or changed
its price, **every past order changed with it**: last month's orders, the labels
you printed, and even the amount a customer saw on their own tracking page all
silently moved to today's wording and today's price. And if you later deleted a
product, its orders fell back to "(deleted product)" with no price at all.

Now each order **freezes the name and price at the moment it is taken** — whether
it came from your shop or you typed it in yourself — and every message, the
tracking page, customer spend totals and the Home estimate read that frozen
record. Rename or reprice a product and the past stays as it was; a product you
delete later still shows what it was that someone bought.

Two careful edges: if you deliberately **swap a line to a different product**
when editing an order, that line picks up the new product's price (you changed
what is being sold), while a line you leave untouched keeps the price it was sold
at. And orders taken **before** today are stamped just once with what they were
already showing, so they stop moving from here on — a line whose product is gone,
or has no price set, is left alone rather than guessed at. Engine v70, guide v70.

## v69 — Either place updates the customer (10 Sep 2026)
Yesterday's fix put a customer's name and number back in one place — but it made
the **customer card** the side that always won, so if the card and an order
disagreed, the card's name was the one shown. That is no longer the rule: now it
is simply **whichever you edited last**. Correct a customer's name with **Edit**
on one of their orders and that is the name the list, the history pop-up and the
"Hi {name}!" greeting use; open their card, type the name and save, and the
card's is the one used. Either place updates the customer — neither is the boss.
They normally read the same anyway, because each save writes through to the
other side; this only decides the rare case where an old copy and a newer one
are both sitting there. Nothing to set up; the phones pick it up with the next
sync.

## v68 — One name and one number per customer (10 Sep 2026)
A customer's name and WhatsApp number used to be held in two places at once — on
their orders, and on their customer card — and the two did not always agree. If
you opened a customer and typed their name on their card, the customer list could
carry on showing the old one, because it read the name off the order. And
renaming someone who has **no WhatsApp number** on file could lose them: the name
is what ties a numberless customer to their history, so the new name slid off
their orders and appeared nowhere at all.

Now the name and number you save on a customer are the ones that count, and
fixing them once fixes them everywhere: saving their card writes the name and
number onto **every order they have**, so the labels, the WhatsApp messages and
the customer list all follow. It works the other way round too — correct a wrong
number with **Edit** on an order and that customer's card updates as well, so the
two can never drift apart again. Correcting a number carries that customer's
bring-a-friend credits across with it, and renaming someone who has no number no
longer loses them.

Leaving a box empty means "leave this as it is" — it never wipes a number your
confirmations depend on. And if you renamed anyone before today and it never
stuck, the app puts their orders right the first time this version opens. Engine
v68, guide v68.

**9 Sep 2026 — the wish list's automatic email went live (no new engine; the
phones did not change).** Adding a wish on **More → Software wish list** now
emails the **full wish list** — every wish, ticked or not, newest first, with
the app version and the date — to the developer address(es) you set under
Settings → **Website & developer**, all on its own, whenever the phone is signed
in and sharing data. Before today that automatic email needed a behind-the-scenes
service that was not switched on yet, so only the **"Email the full wish list"**
row sent it by hand; that row is still there as a backup any time.

## v67 — Naming a "No name" customer (10 Sep 2026)
A customer who reached you without a name — a storefront order that carried none
— used to stay **"No name"** in your customer book even after you opened them and
typed a name. Now it sticks: open them, tap **Add details**, type the name (and
the pet's name, what they like, and so on) and save, and their row shows that
name straight away — in the list, the finder and the 'Hi {name}!' WhatsApp
greeting. A tidy-up; nothing else about your customers changes. Engine v67,
guide v67.

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
