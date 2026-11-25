-- Closed-alpha sign-up control enforced by the database.
-- The app checks AUDEN_SIGNUP_MODE too, but Supabase Auth can be called directly with the public anon key,
-- so the real gate must live here. Manage it with the service role / SQL editor (no client access).

create table public.app_config (
  key text primary key,
  value text not null
);
insert into public.app_config (key, value) values ('signup_mode', 'open');
alter table public.app_config add constraint app_config_signup_mode_check
  check (key <> 'signup_mode' or value in ('open', 'allowlist', 'closed'));

-- Entries are lowercased emails, or '@domain.com' for a whole domain.
create table public.signup_allowlist (
  entry text primary key check (entry = lower(entry) and entry like '%@%'),
  note text,
  created_at timestamptz not null default now()
);

-- RLS on with no policies: invisible to anon/authenticated clients.
alter table public.app_config enable row level security;
alter table public.signup_allowlist enable row level security;
revoke all on public.app_config, public.signup_allowlist from anon, authenticated;

create or replace function public.enforce_signup_mode() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mode text;
  e text := lower(coalesce(new.email, ''));
begin
  select value into mode from app_config where key = 'signup_mode';
  if mode = 'closed' then
    raise exception 'signups_closed' using errcode = '42501';
  elsif mode = 'allowlist' then
    if not exists (
      select 1 from signup_allowlist
      where entry = e or entry = substr(e, position('@' in e))
    ) then
      raise exception 'not_invited' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger enforce_signup_mode before insert on auth.users
  for each row execute function public.enforce_signup_mode();
