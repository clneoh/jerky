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
- The marketing guide is the SOP — keep it in sync with every change (`build_guide.py`, rebuild, re-send the PDF). `marketing/` is gitignored. **Its version FOLLOWS THE ENGINE** (read live from `admin/js/version.js`): an engine build is `v<N>` (e.g. v54); a rebuild that is ONLY a manual/content change adds a letter — `v54a`, `v54b`… — reset to plain `v<N+1>` on the next engine sync. `build_guide.py` reads the engine number itself; just set the PDF-only `LETTER` (currently `""` — the engine is v57, so the manual is plain v57).
- Verify only against an isolated throwaway origin (sandbox), never real data.
- Only create commits when the user explicitly asks.
- The bakery's **real** Supabase url/anonKey and its CNAME domain must NOT be copied into this repo. The jerky Supabase values stay blanked to `"FILLME"` placeholders until the owner creates her own Supabase project. Her OWN domain is final — **`munchies.com.my`** (apex) — set in `CNAME`.

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

Internal storage keys (`localStorage` `bakeadmin.v1` / `bakeadmin.sync` / `bakeadmin.supabase`, sw.js cache `bakeadmin-admin-v1`) are **deliberately unchanged** — they are origin-scoped, so no collision with the bakery on separate domains/ports; renaming adds risk for no user-visible gain.

## Status

**Done so far:**
- Copied code tree, neutralised bakery identity (CNAME empty, Supabase creds → `"FILLME"`).
- Adapted homepage, storefront, and admin visible copy + units + sample data to pet treats / nationwide post (README and this file document it).
- **Domain final: `munchies.com.my`** (2026-09-07) — brand kept "Munchies Furkidz"; `CNAME` now contains `munchies.com.my`; marketing guide rebuilt as v2 with the domain; referral/track links auto-build from `location.origin` so no code changes needed.
- Full test suite green: `node --test test/*.test.js` → **436 tests, all passing** (bakery 430).
- Sandbox-verified on an isolated localhost port: homepage, storefront order flow (falls back to WhatsApp with Supabase `"FILLME"`), admin offline sign-in, Products units, Settings postage card. All 404s observed were the expected `FILLME` Supabase calls — no broken local assets.

**Not done yet (owner go-live, she acts — I guide):**
1. **Name/domain: DONE in the repo** ("Munchies Furkidz", `CNAME` = munchies.com.my, guide v2). Remaining outside the repo: point the domain's DNS at the site and enable GitHub Pages on the repo so munchies.com.my actually serves this folder.
2. Publish this folder as a NEW GitHub repo via GitHub Desktop (Pages on); then set the custom domain (munchies.com.my) in the repo's Pages settings.
3. Create a NEW Supabase project; run the 8 `.sql` files in dependency order (backoffice → storefront → availability → instant_slots → shared_pool_slots → tracking → tracking_stages → incoming_cleanup); create the app-login user. Type email+password once per phone.
4. Give me the new project url/anonKey → I wire the `"FILLME"` spots + the test assertion that checks them.
5. Send product list + photos → I fill the homepage grid (she edits the live menu via the admin app).
6. Set WhatsApp/Instagram, TNG QR, postage fee, PIN — Settings → Storefront on the phone.
7. Test on her phone: order → inbox → confirm → track; then I re-version + re-send the guide PDF.

**Open questions for her (not blockers, settle at go-live):**
- Is **Collect (local)** actually offered, or is delivery strictly postal? The copy currently keeps a "Collect (local)" option (homepage card + storefront toggle) — trim it if she is post-only.
- Product photos are placeholders ("PHOTO COMING SOON") until she sends images.
