create table public.request_applications (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  seller_id uuid not null references public.app_users(id),
  offered_price integer not null,
  message text not null,
  status text not null default '대기중',
  created_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  constraint request_applications_unique_seller_per_request unique (request_id, seller_id),
  constraint request_applications_offered_price_range check (offered_price > 0 and offered_price <= 100000000),
  constraint request_applications_message_length check (char_length(trim(message)) between 10 and 500),
  constraint request_applications_status_allowed check (status in ('대기중', '수락됨', '거절됨'))
);

create index request_applications_request_id_idx on public.request_applications (request_id, created_at desc);
create index request_applications_seller_id_idx on public.request_applications (seller_id, created_at desc);

alter table public.request_applications enable row level security;
revoke all on table public.request_applications from anon, authenticated;
