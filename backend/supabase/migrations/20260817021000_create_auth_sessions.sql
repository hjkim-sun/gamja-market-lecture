-- Opaque application sessions. The raw browser token is never persisted.
create table public.auth_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint auth_sessions_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint auth_sessions_expiry_after_creation check (expires_at > created_at),
  constraint auth_sessions_revocation_after_creation check (
    revoked_at is null or revoked_at >= created_at
  )
);

create index auth_sessions_user_id_idx on public.auth_sessions (user_id);
create index auth_sessions_active_expiry_idx
  on public.auth_sessions (expires_at)
  where revoked_at is null;

alter table public.auth_sessions enable row level security;
revoke all on table public.auth_sessions from anon, authenticated;
