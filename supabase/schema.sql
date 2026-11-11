-- JobSwipe schema. Run in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'reviewer' check (role in ('admin','reviewer')),
  created_at timestamptz not null default now()
);
create unique index if not exists one_jobswipe_admin on public.profiles(role) where role='admin';
create unique index if not exists one_jobswipe_reviewer on public.profiles(role) where role='reviewer';

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company_name text not null default '',
  location_label text not null default '',
  salary_label text not null default '',
  job_description text not null default '',
  status text not null default 'pending' check(status in ('pending','taken','rejected')),
  claimed_by uuid references public.profiles(id),
  claim_until timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jobs_queue_idx on public.jobs(status,created_at);
create index if not exists jobs_claim_idx on public.jobs(claim_until);
create index if not exists jobs_pending_claim_idx on public.jobs(claim_until,created_at) where status='pending';

create table if not exists public.swipe_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  user_id uuid not null references public.profiles(id),
  decision text not null check(decision in ('taken','rejected')),
  created_at timestamptz not null default now(),
  unique(job_id)
);

-- Create profile automatically for every newly created Supabase Auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,email,role)
  values(new.id,new.email,'reviewer');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_jobswipe on auth.users;
create trigger on_auth_user_created_jobswipe after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.swipe_history enable row level security;

create or replace function public.current_jobswipe_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

drop policy if exists "profile self or admin read" on public.profiles;
create policy "profile self or admin read" on public.profiles for select to authenticated
using (id=auth.uid() or public.current_jobswipe_role()='admin');
-- No client-side profile writes: role changes are performed by trusted SQL/admin tooling.

drop policy if exists "admin sees all jobs, reviewer sees own claim" on public.jobs;
create policy "admin sees all jobs, reviewer sees own claim" on public.jobs for select to authenticated
using (public.current_jobswipe_role()='admin' or claimed_by=auth.uid());

drop policy if exists "admin reads all history, reviewer own history" on public.swipe_history;
create policy "admin reads all history, reviewer own history" on public.swipe_history for select to authenticated
using (public.current_jobswipe_role()='admin' or user_id=auth.uid());

-- Admin-only bulk import. Input is a JSON array of normalized job objects.
create or replace function public.admin_import_jobs(p_jobs jsonb)
returns integer language plpgsql security definer set search_path=public
as $$
declare inserted_count integer;
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'admin' then
    raise exception 'Admin access required';
  end if;
  if jsonb_typeof(p_jobs) <> 'array' then raise exception 'p_jobs must be a JSON array'; end if;
  insert into public.jobs(title,company_name,location_label,salary_label,job_description)
  select
    nullif(trim(x->>'title'),''),
    coalesce(x->>'company_name',''),
    coalesce(x->>'location_label',''),
    coalesce(x->>'salary_label',''),
    coalesce(x->>'job_description','')
  from jsonb_array_elements(p_jobs) x
  where nullif(trim(x->>'title'),'') is not null;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Atomic queue claim. Claim expires after 5 minutes if the reviewer closes the tab.
create or replace function public.claim_next_job()
returns setof public.jobs language plpgsql security definer set search_path=public
as $$
declare selected_id uuid;
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'reviewer' then
    raise exception 'Reviewer access required';
  end if;
  -- Reuse this reviewer's active claim after refresh instead of claiming another row.
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

create or replace function public.review_job(p_job_id uuid,p_decision text)
returns void language plpgsql security definer set search_path=public
as $$
declare changed integer;
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'reviewer' then
    raise exception 'Reviewer access required';
  end if;
  if p_decision not in ('taken','rejected') then raise exception 'Invalid decision'; end if;
  update public.jobs set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),
    claimed_by=null,claim_until=null
  where id=p_job_id and status='pending' and claimed_by=auth.uid() and claim_until > now();
  get diagnostics changed = row_count;
  if changed=0 then raise exception 'Lowongan sudah diproses atau klaim sudah kedaluwarsa. Ambil lowongan berikutnya.'; end if;
  insert into public.swipe_history(job_id,user_id,decision) values(p_job_id,auth.uid(),p_decision);
end;
$$;

create or replace function public.admin_job_stats()
returns table(total bigint,pending bigint,taken bigint,rejected bigint)
language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or public.current_jobswipe_role() <> 'admin' then
    raise exception 'Admin access required';
  end if;
  return query select count(*),count(*) filter(where status='pending'),
    count(*) filter(where status='taken'),count(*) filter(where status='rejected')
  from public.jobs;
end;
$$;

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


-- Reviewer-safe aggregate counts. SECURITY DEFINER bypasses row-level visibility
-- so reviewer can see global totals without reading other users' job rows.
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

revoke all on function public.admin_import_jobs(jsonb) from public;
revoke all on function public.claim_next_job() from public;
revoke all on function public.review_job(uuid,text) from public;
revoke all on function public.admin_job_stats() from public;
revoke all on function public.admin_clear_jobs() from public;
revoke all on function public.reviewer_job_stats() from public;
grant execute on function public.admin_import_jobs(jsonb) to authenticated;
grant execute on function public.claim_next_job() to authenticated;
grant execute on function public.review_job(uuid,text) to authenticated;
grant execute on function public.admin_job_stats() to authenticated;
grant execute on function public.admin_clear_jobs() to authenticated;
grant execute on function public.reviewer_job_stats() to authenticated;

-- Prevent direct writes from browser clients; writes go through the guarded RPC functions.
revoke insert,update,delete on public.jobs from anon,authenticated;
revoke insert,update,delete on public.swipe_history from anon,authenticated;
revoke insert,update,delete on public.profiles from anon,authenticated;
grant select on public.jobs,public.profiles,public.swipe_history to authenticated;
