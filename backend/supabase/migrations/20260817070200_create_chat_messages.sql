create table public.chat_messages (
  id uuid primary key,
  thread_id uuid not null references public.chat_threads(id),
  sender_id uuid not null references public.app_users(id),
  body text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint chat_messages_body_length check (char_length(trim(body)) between 1 and 2000)
);

create index chat_messages_thread_id_idx on public.chat_messages (thread_id, created_at asc);

alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from anon, authenticated;
