create table public.application_images (
  id uuid primary key,
  application_id uuid not null references public.request_applications(id),
  storage_path text not null,
  sort_order smallint not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint application_images_unique_slot unique (application_id, sort_order),
  constraint application_images_sort_order_range check (sort_order between 0 and 4),
  constraint application_images_storage_path_not_blank check (char_length(trim(storage_path)) > 0)
);

create index application_images_application_id_idx on public.application_images (application_id, sort_order asc);
alter table public.application_images enable row level security;
revoke all on table public.application_images from anon, authenticated;
