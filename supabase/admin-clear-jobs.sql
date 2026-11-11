-- Install this function on an existing JobSwipe database to enable the Admin
-- dashboard's "Hapus semua lowongan" action.
create or replace function public.admin_clear_jobs()
returns bigint language plpgsql security definer set search_path=public
as $$
declare deleted_count bigint;
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'admin' then
    raise exception 'Admin access required';
  end if;

  lock table public.jobs, public.swipe_history in access exclusive mode;
  delete from public.swipe_history;
  delete from public.jobs;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.admin_clear_jobs() from public;
grant execute on function public.admin_clear_jobs() to authenticated;
