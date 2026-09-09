# Jerky (dehydrated pet treats) — project start

This is a NEW, separate project for the owner's second home-based business: dehydrated pet treats ("jerky"). It is a fresh start on purpose — its own folder, its own git history, its own Claude memory. Do not assume anything here is the bakery.

## The one big fact to know first

This project is a DUPLICATION of the existing bakery system, which lives at:

`/Users/clneoh/Downloads/bakeadmin`

That repo contains: a static shop/storefront, a single-page admin app (`/admin/`), a marketing-guide generator (`marketing/build_guide.py` → `bakester-marketing-guide.pdf`), and Supabase sync. The bakery's live domain is jienluv2bake.com.my (GitHub Pages: root = homepage, /store/ = shop, /admin/ = app).

**The duplication is DONE.** The whole setup was copied into this folder and adapted to dehydrated pet treats (same mechanics — GitHub Pages + Supabase — but its OWN repo, its OWN Supabase project, its OWN domain name, never the bakery's). See "Status" below for where the project stands.

## The owner

- A Malaysian home-based producer, NON-technical. Wants plain-English, step-by-step guidance, and to test on her phone (and Mac).
- Deploys herself via GitHub Desktop — see the rules below.
- She also runs the bakery (jienluv2bake.com.my); this is her second business.

## Standing rules (carried from the bakery — apply to all work here)

- **Never `git commit` or `git push`.** The owner deploys via GitHub Desktop. Report changes and suggest a commit summary instead.
- **Never ship or embed the Supabase app-login email/password.** The owner types both in on each phone (confirmed wanted).
- Keep private keys out of the repo (e.g. any ntfy topic).
- The marketing guide is the SOP — keep it in sync with every change (`build_guide.py`, rebuild, re-send the PDF). `marketing/` is gitignored. **Its version FOLLOWS THE ENGINE** (read live from `admin/js/version.js`): an engine build is `v<N>` (e.g. v65); a rebuild that is ONLY a manual/content change adds a letter — `v65a`, `v65b`… — reset to plain `v<N+1>` on the next engine sync. `build_guide.py` reads the engine number itself; just set the PDF-only `LETTER` (currently `""` — the engine is v65, so the manual is plain v65).
- Verify only against an isolated throwaway origin (sandbox), never real data.
- Only create commits when the user explicitly asks.
- The bakery's **real** Supabase url/anonKey and its CNAME domain must NOT be copied into this repo. jerky keeps its OWN Supabase values (project `ircwozniiyywsowamixy`, in `store/config.js` + `admin/js/state.js` `BUILTIN_SUPABASE`). Her domain is final — **`munchies.com.my`** (apex) — set in `CNAME`.

## Owner decisions (confirmed 2026-09-06)

1. **Business name: "Munchies Furkidz"** — display brand, kept. **Domain: `munchies.com.my`** (apex, no "www") — registered/active 2026-09-07, set in `CNAME`. She may still fine-tune the exact display wording later; if so, rebuild the guide PDF and update branding single-points.
2. **Delivery: post nationwide** (shelf-stable jerky). **Flat postage fee per order**, default RM8 — added by the owner at confirmation, NOT auto-added to the storefront total. Stored as `settings.storefront.postageRM` (default 8), edited in admin **Settings → Storefront → Postage (nationwide posting)**, read by the WhatsApp confirm/payment builders. It syncs between HER phones via the PRIVATE shared-data settings row (last person who set it wins, so both quote the same) but is deliberately **never published** to the public storefront. Emitting it from a phone is gated by `settings.storefront.postageSet === true` — a phone still at the default 8 must not overwrite the value she set on another phone (same guard as the tasks list).
3. **Delivery-date mechanics are IDENTICAL to bakeadmin**: `deliveryDays [1,3,5]` (Mon/Wed/Fri), cutoff 18:00, same date picker/capacity/limits. Copy-only relabel: the picked day is her batch/posting day.
4. **Back-office: copied entirely** (orders, products + cost recipes, ingredients, PO, suppliers, customers, referrals).
5. **Product form: pouches by weight** (e.g. "100g pouch").

## Duplication vocabulary (internal ids are KEPT — no schema migration)

| Concept | Internal value | User-visible wording |
|---|---|---|
| Brand | `Bakester`-era keys kept origin-scoped | Munchies Furkidz, paw 🐾 |
| Status | `baking` | **Preparing** (journey: New → Confirmed → Paid → Preparing → Packed → Delivered) |
| Fulfilment | `courier` / `collect` | **Post (nationwide)** / **Collect (local)** |
| Units | generic free-text `unit` | pouch, pack, jar, box, bag, set, piece (+ pcs) |
| Postage | `settings.storefront.postageRM` (+ `postageSet` gate) | flat per-order fee, on the WhatsApp To-pay line; private phone-to-phone sync (last-set wins), never on the storefront |
| Backup marker | `o.app` | `"furkidz"`, file `furkidz-backup-*.json` |
| Customer-profile fields | `dogName` / `dogPhoto` (kept, like status ids) | **pet's name** / pet photo; 🐾; customers CSV `munchies-furkidz-customers-*.csv` |
| Change history | — | `CHANGELOG.md` (localized v54→v65) → root `changelog.pdf` (via gitignored `marketing/build_changelog.py`), linked from More → Full change history |

Internal storage keys (`localStorage` `bakeadmin.v1` / `bakeadmin.sync` / `bakeadmin.supabase`, sw.js cache `bakeadmin-admin-v1`) are **deliberately unchanged** — they are origin-scoped, so no collision with the bakery on separate domains/ports; renaming adds risk for no user-visible gain.

## Status

**Done so far:**
- Copied code tree, neutralised bakery identity (CNAME empty, Supabase creds → `"FILLME"`).
- Adapted homepage, storefront, and admin visible copy + units + sample data to pet treats / nationwide post (README and this file document it).
- **Domain final: `munchies.com.my`** (2026-09-07) — brand kept "Munchies Furkidz"; `CNAME` now contains `munchies.com.my`; marketing guide rebuilt as v2 with the domain; referral/track links auto-build from `location.origin` so no code changes needed.
- Full test suite green: `node --test test/*.test.js` → **528 tests, all passing** (501 pre-v65-sync; 470 pre-v63-sync; 436 pre-v61-sync).
- **Engine synced to v61** (2026-09-08) — bakery HEAD → jerky, wholesale for the business-agnostic engine files: occasion import catalogue + whole-group ticking (`occasion_catalog.js`, `deliveries.js`, `.mycal-*` CSS), homepage customer reviews with approve-first moderation (`views/reviews.js`, root `reviews.js`, homepage section, `supabase/reviews.sql`), and cloud backups Daily/Weekly/Monthly/manual with restore/download/delete (`backups.js`, `Backup & safety` card, `supabase/backups.sql`). jerky-localized files hand-merged (app.js, supabase.js, settings.js, more.js, guide.js, README). Marketing guide rebuilt as plain v61.
- **Engine synced to v63** (2026-09-09) — bakery HEAD 3f39105→62cf7e0 → jerky, **code-only (no SQL)**: v62 amber "Not sharing right now" strip on every screen (`sharewarn.js`) + read-only **View** of each backup copy (`snapshot.js`, Settings row buttons), and v63 **5-tab swap** (Customers becomes a bottom tab, PO moves under More) with customer **profiles** (pet name/photo/likes/avoid/note + finder; `profiles.js`, `photo.js` shrink, views/customers.js pet wording), always-on Home **Upcoming holidays** card (`views/dashboard.js`, `.hol-list--scroll`), and More **Engine pill + Software wish list + Full change history** linking a new root `changelog.pdf` (`wishlist.js`, `views/more.js`, localized `CHANGELOG.md` + `marketing/build_changelog.py`, gitignored). Hand-merged keeping localization in state.js, sync.js (customers LISTS + wishList guard; postage hunks intact), backups.js, dashboard/settings/more/guide/app.js, homepage index.html (review-photo shrink), app.css. Marketing guide + Guide screen updated to the v63 UI; marketing guide rebuilt as plain v63 (21 pages).
- **Engine synced to v65** (2026-09-09) — bakery HEAD 62cf7e0→8a09b11 → jerky, **code-only (no SQL)**. **v64:** trilingual **EN / 中文 / BM** switch on homepage + order page (`i18n.js`, `home-lang.js`, `store-lang.js`, `home.js`, `store/app.js`), optional per-product **Shop names** (`nameZh`/`nameMs`), homepage reviews as an automatic swipeable **carousel** (`reviews.js`), and a **Website & developer** credit — Settings card sets name/emails/WhatsApp; "Website by …" shows on homepage + store footer and More → About gains WhatsApp/email rows; the software wish list emails the developer (`devmail.js`, optional `supabase/functions/wish-mail` Edge Function + manual mailto row). **v65:** More → Reviews shows each review **one at a time** exactly as it will render (waiting-to-publish first; Publish/Take down/Delete moves on), with "N waiting" pills on More and a Home review card (`views/reviews.js` byte-identical, `views/dashboard.js` +45 s refresh). Hand-merged keeping localization (postage hunks, Munchies wording in state/sync/more/dashboard/settings/app.js, homepage/store index.html, app.css). Guide screen "Newest in the engine" cards, CHANGELOG + root `changelog.pdf` rebuilt, README; marketing guide rebuilt as plain v65 (22 pages).
- Sandbox-verified on an isolated localhost port: homepage, storefront order flow, admin offline sign-in, Products units, Settings postage card, Settings Backup & safety cloud-copies card, EN↔中文↔BM switch on homepage + order page, empty-reviews state, hidden dev credit, mobile 375 px no overflow. No broken local assets; no console errors.

**Not done yet (owner go-live, she acts — I guide):**
1. **Supabase project: DONE** (2026-09-07) — her own project `ircwozniiyywsowamixy`, all core `.sql` run, creds wired into `store/config.js` + `admin/js/state.js`. **SQL still to run from the 2026-09-08 v61 sync:** `supabase/reviews.sql` and `supabase/backups.sql` in the SQL editor (once) so the homepage-reviews table/bucket and cloud-backup snapshots exist. (The 2026-09-09 v62/v63 and v64/v65 syncs are code-only — no new SQL. Optional, not required: deploy the `supabase/functions/wish-mail` Edge Function + set RESEND to make the wish-list email send automatically; without it the manual "Email the full wish list" row works instead.)
2. **Domain: DONE in the repo** (CNAME = munchies.com.my). Outside the repo: point the domain's DNS at the site and enable GitHub Pages on the repo so munchies.com.my actually serves this folder (owner commits/pushes via GitHub Desktop first).
3. Send product list + photos → I fill the homepage grid (she edits the live menu via the admin app).
4. Set WhatsApp/Instagram, TNG QR, postage fee, PIN — Settings → Storefront on the phone.
5. Test on her phone: order → inbox → confirm → track; then I re-version + re-send the guide PDF.

**Open questions for her (not blockers, settle at go-live):**
- Is **Collect (local)** actually offered, or is delivery strictly postal? The copy currently keeps a "Collect (local)" option (homepage card + storefront toggle) — trim it if she is post-only.
- The occasion import catalogue (Delivery calendar → Add occasion) is byte-identical to the bakery, so its groups include "Baking & sweet days" (Cookie Day etc.) alongside pet/people days. If she doesn't want baking-promo days on a pet-treat calendar, the catalogue becomes a permanent jerky-localized file (trimmed) on the next sync — reversible either way.
- Product photos are placeholders ("PHOTO COMING SOON") until she sends images.
