alter table public.app_users
  add column display_name text;

update public.app_users
set display_name = '감자-' || id::text
where display_name is null;

alter table public.app_users
  alter column display_name set not null,
  add constraint app_users_display_name_length
    check (char_length(trim(display_name)) between 1 and 40),
  add constraint app_users_display_name_unique unique (display_name);
