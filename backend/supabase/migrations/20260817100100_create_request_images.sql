create table public.request_images (
  id uuid primary key,
  request_id uuid not null references public.purchase_requests(id),
  storage_path text not null,
  sort_order smallint not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint request_images_unique_slot unique (request_id, sort_order),
  constraint request_images_sort_order_range check (sort_order between 0 and 4),
  constraint request_images_storage_path_not_blank check (char_length(trim(storage_path)) > 0)
);

create index request_images_request_id_idx on public.request_images (request_id, sort_order asc);
alter table public.request_images enable row level security;
revoke all on table public.request_images from anon, authenticated;
