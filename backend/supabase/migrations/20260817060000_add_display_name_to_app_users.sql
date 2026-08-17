alter table public.app_users
  add column display_name text not null,
  add constraint app_users_display_name_length
    check (char_length(trim(display_name)) between 1 and 40);
