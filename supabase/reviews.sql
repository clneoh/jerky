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
--   name/message are trimmed on insert by the app; the check constraints are a
--   backstop. stars is 1–5. lang is the review language — 'en' (English),
--   'zh' (Chinese/Mandarin) or 'ms' (Bahasa Malaysia).
--   photo holds the public URL of the customer's uploaded picture, stored in
--   the "review-photos" bucket below. Blank when there is no photo.

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
  with check (true);

drop policy if exists "public reads published reviews" on reviews;
create policy "public reads published reviews" on reviews
  for select to anon
  using (published);

drop policy if exists "baker moderates reviews" on reviews;
create policy "baker moderates reviews" on reviews
  for all to authenticated
  using (true) with check (true);

-- The photo bucket. Public read, and customers may only add (never overwrite,
-- delete or list) — one picture per review upload.
insert into storage.buckets (id, name, public)
values ('review-photos', 'review-photos', true)
on conflict (id) do nothing;

drop policy if exists "customer uploads a review photo" on storage.objects;
create policy "customer uploads a review photo" on storage.objects
  for insert to anon
  with check (bucket_id = 'review-photos');

drop policy if exists "anyone reads review photos" on storage.objects;
create policy "anyone reads review photos" on storage.objects
  for select to anon
  using (bucket_id = 'review-photos');
