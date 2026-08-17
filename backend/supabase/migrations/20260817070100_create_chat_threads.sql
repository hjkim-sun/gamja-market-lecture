create table public.chat_threads (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  application_id uuid not null references public.request_applications(id),
  buyer_id uuid not null references public.app_users(id),
  seller_id uuid not null references public.app_users(id),
  created_at timestamptz not null default timezone('utc', now()),
  constraint chat_threads_unique_application unique (application_id),
  constraint chat_threads_buyer_seller_distinct check (buyer_id <> seller_id)
);

create index chat_threads_buyer_id_idx on public.chat_threads (buyer_id, created_at desc);
create index chat_threads_seller_id_idx on public.chat_threads (seller_id, created_at desc);

alter table public.chat_threads enable row level security;
revoke all on table public.chat_threads from anon, authenticated;
