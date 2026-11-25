-- Auden Alpha 0.1 — initial schema.
-- All user data is isolated by Row Level Security on auth.uid().

create extension if not exists pgcrypto;

-- ---------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text check (char_length(display_name) <= 60),
  locale text not null default 'ru' check (locale in ('ru', 'en')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  default_mode text not null default 'core' check (default_mode in ('air', 'core', 'prime')),
  memory_enabled boolean not null default true,
  custom_instructions text check (char_length(custom_instructions) <= 2000),
  created_at timestamptz not null default now()
);

-- ---------- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 1000),
  instructions text check (char_length(instructions) <= 4000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_updated_idx on public.projects (user_id, updated_at desc);

-- ---------- conversations
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  favorite boolean not null default false,
  mode text not null default 'core' check (mode in ('air', 'core', 'prime')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_updated_idx on public.conversations (user_id, updated_at desc);
create index conversations_project_idx on public.conversations (project_id);

-- ---------- messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 100000),
  provider text,
  model text,
  status text not null default 'complete' check (status in ('complete', 'error', 'cancelled')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_user_idx on public.messages (user_id);

-- ---------- memories
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  content text not null check (char_length(content) between 1 and 500),
  source text not null check (source in ('chat', 'manual')),
  source_conversation_id uuid references public.conversations (id) on delete set null,
  consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_updated_idx on public.memories (user_id, updated_at desc);

-- ---------- attachments (reserved for text/PDF uploads; storage bucket must be private)
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  path text not null,
  mime text not null check (mime in ('text/plain', 'text/markdown', 'application/pdf')),
  size integer not null check (size > 0 and size <= 5242880),
  created_at timestamptz not null default now()
);
create index attachments_user_idx on public.attachments (user_id, created_at desc);

-- ---------- usage_events (append-only for users: no update/delete policies, so quotas cannot be reset)
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost numeric(12, 6) not null default 0 check (cost >= 0),
  status text not null default 'complete' check (status in ('complete', 'error', 'cancelled')),
  created_at timestamptz not null default now()
);
create index usage_events_user_created_idx on public.usage_events (user_id, created_at desc);
create index usage_events_created_idx on public.usage_events (created_at desc);

-- ---------- training_consents (explicit, versioned, revocable; nothing is used for training by default)
create table public.training_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index training_consents_user_idx on public.training_consents (user_id);

-- ---------- ownership integrity: child rows must reference parents owned by the same user
create or replace function public.check_same_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'messages' then
    if not exists (select 1 from conversations c where c.id = new.conversation_id and c.user_id = new.user_id) then
      raise exception 'conversation not owned by user' using errcode = '42501';
    end if;
  elsif tg_table_name = 'conversations' or tg_table_name = 'memories' then
    if new.project_id is not null and not exists (select 1 from projects p where p.id = new.project_id and p.user_id = new.user_id) then
      raise exception 'project not owned by user' using errcode = '42501';
    end if;
    if tg_table_name = 'memories' then
      if new.source_conversation_id is not null
         and not exists (select 1 from conversations c where c.id = new.source_conversation_id and c.user_id = new.user_id) then
        raise exception 'conversation not owned by user' using errcode = '42501';
      end if;
    end if;
  elsif tg_table_name = 'attachments' then
    if new.conversation_id is not null and not exists (select 1 from conversations c where c.id = new.conversation_id and c.user_id = new.user_id) then
      raise exception 'conversation not owned by user' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger messages_owner before insert or update on public.messages for each row execute function public.check_same_owner();
create trigger conversations_owner before insert or update on public.conversations for each row execute function public.check_same_owner();
create trigger memories_owner before insert or update on public.memories for each row execute function public.check_same_owner();
create trigger attachments_owner before insert or update on public.attachments for each row execute function public.check_same_owner();

-- bump conversation.updated_at when a message is added
create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update conversations set updated_at = now() where id = new.conversation_id;
  return new;
end $$;
create trigger messages_touch after insert on public.messages for each row execute function public.touch_conversation();

-- create a profile row for every new auth user
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- RLS
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.attachments enable row level security;
alter table public.usage_events enable row level security;
alter table public.training_consents enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy projects_all on public.projects for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy conversations_all on public.conversations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy messages_all on public.messages for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy memories_all on public.memories for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy attachments_all on public.attachments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy usage_select on public.usage_events for select to authenticated using (user_id = auth.uid());
create policy usage_insert on public.usage_events for insert to authenticated with check (user_id = auth.uid());

create policy consents_select on public.training_consents for select to authenticated using (user_id = auth.uid());
create policy consents_insert on public.training_consents for insert to authenticated with check (user_id = auth.uid());
create policy consents_update on public.training_consents for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- profile email is managed by auth; prevent users from changing it
create or replace function public.protect_profile_email() returns trigger
language plpgsql as $$
begin
  if new.email is distinct from old.email or new.id is distinct from old.id then
    raise exception 'email and id are read-only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile_email();

-- ---------- aggregate usage for global ceilings (no per-user data leaves the function)
create or replace function public.global_usage_since(since timestamptz)
returns table (requests bigint, cost numeric)
language sql security definer stable set search_path = public as $$
  select count(*)::bigint, coalesce(sum(cost), 0)::numeric from usage_events where created_at >= since;
$$;
revoke all on function public.global_usage_since(timestamptz) from public;
grant execute on function public.global_usage_since(timestamptz) to authenticated;

-- ---------- account deletion by the user (cascades to all owned rows)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- table privileges for the authenticated role (RLS still applies)
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects, public.conversations, public.messages, public.memories, public.attachments to authenticated;
grant select, insert on public.usage_events to authenticated;
grant select, insert, update on public.training_consents to authenticated;
