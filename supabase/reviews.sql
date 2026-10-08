-- Customer reviews for the homepage.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the table is created only if missing, policies are dropped
-- and recreated, and the storage bucket is created once.
--
-- reviews: a review posted from the homepage "What customers say" form. Anyone
--   can insert (the form is public) but every row starts unpublished, and only
--   signed-in bakers can read, publish or delete — so nothing shows on the
--   homepage until the owner taps Publish in the admin app (More → Reviews).
--   Published reviews are readable by anyone (the homepage shows them);
--   unpublished rows are invisible to the public, which keeps spam private.
--
-- ⚠️⚠️ 08 Oct 2026 — THE INSERT POLICY NOW ENFORCES THAT, AND UNTIL THEN IT DID
--   NOT. The paragraph above was true of the COLUMN DEFAULT (`published=false`)
--   and NOT of what an anonymous visitor was ALLOWED TO SEND: the policy was
--   `with check (true)`, and there is no trigger on this table anywhere, so
--   anyone with the public anon key (it is in the homepage's own script) could
--   POST `{"published": true, ...}` straight to the REST API and **publish their
--   own review**, skipping the moderation step entirely — and the "public reads
--   published reviews" policy below would then serve it on the homepage.
--   ⚠️ NOT a data leak — no customer data is exposed by it — but it defeated the
--   approve-first design this table exists for. The fix is one clause:
--   `with check (published = false)`, so a new row cannot arrive already live.
--   ⚠️ Safe for the real form: `reviews.js` `submitReview` sends only name,
--   stars, message, lang and photo (guarded by a test), so the default applies
--   and every genuine review still lands unpublished as it always did.
--
--   name/message are trimmed on insert by the app; the check constraints are a
--   backstop. stars is 1–5. lang is the review language — 'en' (English),
--   'zh' (Chinese/Mandarin) or 'ms' (Bahasa Malaysia).
--
--   ⚠️⚠️ `photo` HOLDS ONE OF TWO SHAPES, AND THAT IS DELIBERATE (v384).
--   While the review is UNPUBLISHED it holds the customer's picture as a bare
--   PATH into the private bucket. Once the owner publishes, her app copies the
--   file into the public bucket and `photo` becomes the full public URL the
--   homepage reads. A bare path is never a URL and a URL always starts with
--   http, so `isPendingPhoto()` in admin/js/supabase.js tells them apart, and the
--   two shapes are handled in exactly two places — the moderator card and the
--   Publish/Take-down actions. **A second column was deliberately NOT added**: a
--   new column breaks every explicit `select=` that names the old ones, and two
--   selects would have to be kept in step for ever.
--   Blank when there is no photo.

create table if not exists reviews (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  stars      smallint not null check (stars between 1 and 5),
  message    text not null check (char_length(btrim(message)) between 1 and 400),
  lang       text not null default 'en' check (lang in ('en', 'zh', 'ms')),
  photo      text not null default '',
  published  boolean not null default false
);

alter table reviews enable row level security;

drop policy if exists "customer leaves a review" on reviews;
create policy "customer leaves a review" on reviews
  for insert to anon
  -- ⚠️⚠️ `published = false`, NOT `true`. A visitor may ADD a review; a visitor may
  -- not arrive with one already published. See the note at the top of this file.
  with check (published = false);

drop policy if exists "public reads published reviews" on reviews;
create policy "public reads published reviews" on reviews
  for select to anon
  using (published);

drop policy if exists "baker moderates reviews" on reviews;
create policy "baker moderates reviews" on reviews
  for all to authenticated
  using (true) with check (true);

-- ── THE TWO PHOTO BUCKETS (v384) ────────────────────────────────────────────
-- ⚠️⚠️ A PICTURE IS PRIVATE UNTIL THE OWNER PUBLISHES THE REVIEW.
--
-- A customer's picture goes into `review-photos-pending`, which is PRIVATE: nobody
-- anonymous can read it, not even with the exact link. When the owner presses
-- Publish, her app copies the file into `review-photos` (public) and stores that
-- public address on the review — so the homepage carousel reads exactly what it
-- always read, and only ever sees pictures she has approved.
--
-- ⚠️⚠️ THE LOAD-BEARING LINE BELOW IS THE ONE THAT IS *NO LONGER THERE*: the anon
-- INSERT on the public bucket. That removal is the only thing standing between the
-- homepage and a picture nobody has approved. **Do not add it back.**
--
-- ⚠️ AND BOTH BUCKETS NOW CARRY A LIMIT. Until v384 neither had a size or a type
-- limit at all, so anyone with the public key (it is in the homepage's own script)
-- could use this storage as free hosting for any file of any size. The shop shrinks
-- a photo to a small JPEG before it uploads, so 2 MB is generous headroom and never
-- refuses a real one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 2097152,
        '{image/jpeg,image/png,image/webp,image/gif}'::text[])
-- ⚠️ `do update`, NOT `do nothing`: this bucket already exists on her project, and
-- `do nothing` would leave it exactly as it was — with no limit at all, which is
-- half of what is being fixed here.
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos-pending', 'review-photos-pending', false, 2097152,
        '{image/jpeg,image/png,image/webp,image/gif}'::text[])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The customer's upload. INSERT only, and only into the PRIVATE bucket — they can
-- add a picture and can never read, list, overwrite or delete one.
drop policy if exists "customer uploads a review photo" on storage.objects;
create policy "customer uploads a review photo" on storage.objects
  for insert to anon
  with check (bucket_id = 'review-photos-pending');

-- The homepage, and anyone else, reads APPROVED pictures only. `review-photos`
-- now only ever contains those, because anon cannot write to it at all.
drop policy if exists "anyone reads review photos" on storage.objects;
create policy "anyone reads review photos" on storage.objects
  for select to anon
  using (bucket_id = 'review-photos');

-- The owner's app: read the pending picture so she can judge it, copy it across
-- when she presses Publish, and delete it on Take down or Delete. ⚠️ `authenticated`
-- only — this is the policy that lets a PRIVATE picture be seen at all, and it must
-- never be widened to `anon`.
drop policy if exists "baker manages review photos" on storage.objects;
create policy "baker manages review photos" on storage.objects
  for all to authenticated
  using (bucket_id in ('review-photos', 'review-photos-pending'))
  with check (bucket_id in ('review-photos', 'review-photos-pending'));
