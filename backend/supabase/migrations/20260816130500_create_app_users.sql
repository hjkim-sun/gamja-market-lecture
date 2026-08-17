-- Application-owned accounts.  This intentionally has no dependency on auth.users
-- or Supabase Auth triggers: FastAPI is the only writer for password credentials.
create table public.app_users (
  id uuid primary key,
  email text not null,
  normalized_email text not null,
  password_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint app_users_normalized_email_key unique (normalized_email),
  constraint app_users_email_not_blank check (char_length(trim(email)) > 0),
  constraint app_users_normalized_email_not_blank check (char_length(trim(normalized_email)) > 0),
  constraint app_users_password_hash_not_blank check (char_length(password_hash) > 0)
);

-- The API connects with a private database credential, not the browser's Supabase
-- client.  Keep direct PostgREST access disabled for anonymous/authenticated roles.
alter table public.app_users enable row level security;
revoke all on table public.app_users from anon, authenticated;
