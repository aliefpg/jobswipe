-- JobSwipe patch: fitur Undo untuk membatalkan keputusan terakhir Reviewer.
create or replace function public.reviewer_can_undo()
returns boolean
language sql
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.current_jobswipe_role() = 'reviewer'
    and exists (select 1 from public.swipe_history where user_id = auth.uid());
$$;
revoke all on function public.reviewer_can_undo() from public;
grant execute on function public.reviewer_can_undo() to authenticated;

-- Jalankan SEKALI di Supabase SQL Editor. Tidak menghapus tabel atau data lain.

create or replace function public.undo_last_review()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  last_action public.swipe_history%rowtype;
  restored_job public.jobs%rowtype;
  changed integer;
  total_count bigint;
  pending_count bigint;
  taken_count bigint;
  rejected_count bigint;
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'reviewer' then
    raise exception 'Reviewer access required';
  end if;

  -- Lock aksi terakhir milik reviewer ini agar tidak di-undo dua kali bersamaan.
  select * into last_action
  from public.swipe_history
  where user_id = auth.uid()
  order by created_at desc, id desc
  limit 1
  for update;

  if last_action.id is null then
    raise exception 'Belum ada pilihan yang bisa di-undo.';
  end if;

  -- Lepaskan kartu berikutnya yang sedang dipegang reviewer, jika ada.
  update public.jobs
  set claimed_by = null, claim_until = null
  where claimed_by = auth.uid()
    and status = 'pending'
    and id <> last_action.job_id;

  -- Kembalikan lowongan terakhir ke pending dan langsung klaim kembali untuk reviewer ini.
  update public.jobs
  set status = 'pending',
      reviewed_by = null,
      reviewed_at = null,
      claimed_by = auth.uid(),
      claim_until = now() + interval '5 minutes'
  where id = last_action.job_id
    and reviewed_by = auth.uid()
    and status = last_action.decision;
  get diagnostics changed = row_count;

  if changed = 0 then
    raise exception 'Lowongan tidak bisa dikembalikan. Statusnya mungkin sudah berubah.';
  end if;

  delete from public.swipe_history where id = last_action.id;

  select * into restored_job from public.jobs where id = last_action.job_id;

  select count(*),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'taken'),
    count(*) filter (where status = 'rejected')
  into total_count, pending_count, taken_count, rejected_count
  from public.jobs;

  return jsonb_build_object(
    'job', to_jsonb(restored_job),
    'stats', jsonb_build_object(
      'total', total_count,
      'pending', pending_count,
      'taken', taken_count,
      'rejected', rejected_count
    )
  );
end;
$$;

revoke all on function public.undo_last_review() from public;
grant execute on function public.undo_last_review() to authenticated;
