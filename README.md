# JobSwipe — Next.js + Supabase + Vercel

A shared-queue job review app with one Admin and one Reviewer:
- Admin imports Excel into PostgreSQL and exports taken/rejected results.
- Reviewer swipes jobs; each decision is saved immediately.
- Queue claims expire after 5 minutes if the reviewer leaves the tab.
- PostgreSQL RPCs and RLS enforce permissions; hiding UI controls is not the security boundary.

## 1. Supabase setup
1. Create a Supabase project.
2. Open SQL Editor and run all of `supabase/schema.sql`.
3. In Authentication > Providers, enable Email.
4. For a simple private app, disable public signups after creating the two accounts (Authentication > Settings / User Signups).
5. Create the Admin user first from Authentication > Users > Add user.
6. Copy that user's UUID. Run:
   ```sql
   update public.profiles set role='admin' where id='ADMIN-USER-UUID';
   ```
7. Create the Reviewer user from Authentication > Users > Add user. The trigger creates its profile with role `reviewer`.
8. The schema enforces one admin and one reviewer. If you need to replace an account, change/delete the old profile role before creating/promoting another account.

Important: create/promote the Admin before creating the Reviewer, because the database intentionally allows only one profile per role.

## 2. Local development
```bash
cp .env.example .env.local
```
Set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or Supabase publishable key)

Then:
```bash
npm install
npm run dev
```
Open http://localhost:3000

## 3. Vercel deployment
1. Push this project to a private GitHub repository.
2. Import the repository in Vercel.
3. Add the two environment variables above in Project Settings > Environment Variables.
4. Deploy.
5. Open the deployed URL and sign in using the Admin or Reviewer account.

## 4. Excel format
The first worksheet is read. Supported columns:
- `title` (required; aliases: `job title`, `position`, `posisi`)
- `company_name` (alias: `company`, `perusahaan`)
- `location_label` (alias: `location`, `lokasi`)
- `salary_label` (alias: `salary`, `gaji`)
- `job_description` (aliases: `description`, `deskripsi`, `job description`)

The original source file's columns map directly:
`title`, `company_name`, `location_label`, `salary_label`, `job_description`.

Import currently appends new rows. Do not import the same workbook twice unless duplicate rows are intended. Export produces two separate workbooks:
- `lowongan-diambil.xlsx`
- `lowongan-dibuang.xlsx`

## 5. Shared queue behavior
The reviewer calls `claim_next_job()` to atomically claim one pending job. The database locks the selected row (`FOR UPDATE SKIP LOCKED`) and leases it for five minutes. Swipe calls `review_job()` which verifies the current reviewer owns a non-expired claim before changing status and inserting history. If a tab is abandoned, the claim can be reclaimed after expiry.

## 6. Security notes
- Do not put a Supabase service-role key in browser code or `NEXT_PUBLIC_*` variables.
- Role assignment is deliberately not exposed to the client. Set roles from Supabase SQL Editor.
- RLS restricts reviewer reads to their currently claimed job and their own history.
- Admin exports use the authenticated browser client; RLS allows admin to read all jobs.
- For production, configure SMTP, strong passwords, HTTPS, and restrict who can create Auth users.
