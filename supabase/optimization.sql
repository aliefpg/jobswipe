-- Jalankan sekali di Supabase SQL Editor untuk project JobSwipe yang sudah berjalan.

-- Index parsial agar pencarian antrean pending tidak perlu memindai semua status.
create index if not exists jobs_pending_claim_idx
on public.jobs(claim_until, created_at)
where status = 'pending';

-- Ambil ulang klaim aktif milik reviewer saat halaman di-refresh.
-- Menghapus UPDATE massal yang sebelumnya dijalankan setiap kali claim_next_job dipanggil.
create or replace function public.claim_next_job()
returns setof public.jobs language plpgsql security definer set search_path=public
as $$
declare selected_id uuid;
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'reviewer' then
    raise exception 'Reviewer access required';
  end if;

  select id into selected_id from public.jobs
  where status='pending' and claimed_by=auth.uid() and claim_until > now()
  order by created_at,id limit 1;

  if selected_id is null then
    select id into selected_id from public.jobs
    where status='pending'
      and (claimed_by is null or claim_until < now())
    order by created_at,id
    for update skip locked limit 1;
  end if;

  if selected_id is null then return; end if;

  update public.jobs set claimed_by=auth.uid(),claim_until=now()+interval '5 minutes'
  where id=selected_id;
  return query select * from public.jobs where id=selected_id;
end;
$$;

-- Statistik global khusus reviewer. Reviewer hanya mendapat angka agregat,
-- bukan akses untuk membaca data lowongan milik reviewer lain.
create or replace function public.reviewer_job_stats()
returns table(total bigint,pending bigint,taken bigint,rejected bigint)
language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'reviewer' then
    raise exception 'Reviewer access required';
  end if;

  return query select count(*),
    count(*) filter(where status='pending'),
    count(*) filter(where status='taken'),
    count(*) filter(where status='rejected')
  from public.jobs;
end;
$$;

revoke all on function public.reviewer_job_stats() from public;
grant execute on function public.reviewer_job_stats() to authenticated;
