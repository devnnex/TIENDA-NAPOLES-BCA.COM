alter table public.business_settings
  add column if not exists tips_enabled boolean not null default false,
  add column if not exists tip_percentage integer not null default 10;

alter table public.business_settings
  alter column tips_enabled set default false,
  alter column tip_percentage set default 10;

alter table public.business_settings
  drop constraint if exists business_settings_tip_percentage_check;

alter table public.business_settings
  add constraint business_settings_tip_percentage_check
  check (tip_percentage between 1 and 100);
