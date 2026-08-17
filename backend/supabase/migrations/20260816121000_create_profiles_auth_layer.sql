-- Stage 2: Supabase Auth-backed application profiles.
-- The auth.users trigger is the sole profile creator; browser roles cannot insert,
-- delete, or choose a role after sign-up.

create type public.app_role as enum ('buyer', 'seller');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  display_name text check (
    display_name is null
    or char_length(trim(display_name)) between 1 and 40
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;

-- Runs as its owner because auth.users is not writable from PostgREST.  An invalid
-- or missing role aborts the Auth insert, so every application user has a safe role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  requested_display_name text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  if requested_role not in ('buyer', 'seller') then
    raise exception 'profile role must be buyer or seller';
  end if;

  insert into public.profiles (id, role, display_name)
  values (new.id, requested_role::public.app_role, requested_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger on_profile_updated
  before update on public.profiles
  for each row execute procedure public.set_profile_updated_at();

-- Explicit least-privilege grants.  The authenticated role can read and rename
-- only its own profile through the policies below; it cannot alter role or id.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_profile_updated_at() from public, anon, authenticated;

create policy "profiles: authenticated users read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: authenticated users update their own display name"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
