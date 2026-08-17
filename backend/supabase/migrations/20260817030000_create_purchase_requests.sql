create table public.purchase_requests (
  id uuid primary key,
  requester_id uuid not null references public.app_users(id),
  title text not null,
  category text not null,
  desired_price integer not null,
  description text not null,
  status text not null default '모집중',
  created_at timestamptz not null default timezone('utc', now()),
  constraint purchase_requests_title_length check (char_length(trim(title)) between 2 and 80),
  constraint purchase_requests_category_allowed check (
    category in ('디지털기기', '가구/인테리어', '게임/취미', '스포츠/레저', '생활가전', '기타')
  ),
  constraint purchase_requests_desired_price_range check (desired_price > 0 and desired_price <= 100000000),
  constraint purchase_requests_description_length check (char_length(trim(description)) between 10 and 2000),
  constraint purchase_requests_status_allowed check (status in ('모집중', '협의중', '마감'))
);

create index purchase_requests_created_at_idx on public.purchase_requests (created_at desc);

alter table public.purchase_requests enable row level security;
revoke all on table public.purchase_requests from anon, authenticated;
