-- Alpha metrics: request timing, answer feedback, admin-only aggregates (no message content).

alter table public.usage_events
  add column mode text check (mode in ('air', 'core', 'prime')),
  add column ttft_ms integer check (ttft_ms >= 0),
  add column latency_ms integer check (latency_ms >= 0),
  add column error_code text check (char_length(error_code) <= 40);

-- One rating per user per assistant message.
create table public.message_feedback (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_feedback_created_idx on public.message_feedback (created_at);

create or replace function public.check_feedback_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from messages m where m.id = new.message_id and m.user_id = new.user_id and m.role = 'assistant') then
    raise exception 'can only rate own assistant messages' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger message_feedback_target before insert or update on public.message_feedback
  for each row execute function public.check_feedback_target();

alter table public.message_feedback enable row level security;
create policy feedback_all on public.message_feedback for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.message_feedback to authenticated;

-- Admins are managed by the owner (SQL editor / service role). Invisible to clients.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Aggregate-ready rows for the metrics page. Returns no message text, titles, emails or memories.
create or replace function public.admin_metrics_data(since timestamptz) returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'createdAt', created_at)) from profiles), '[]'::jsonb),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', user_id, 'provider', provider, 'model', model, 'mode', mode, 'status', status,
        'errorCode', error_code, 'ttftMs', ttft_ms, 'latencyMs', latency_ms,
        'inputTokens', input_tokens, 'outputTokens', output_tokens, 'cost', cost, 'createdAt', created_at))
      from usage_events where created_at >= since), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object('rating', f.rating, 'provider', m.provider, 'model', m.model, 'createdAt', f.created_at))
      from message_feedback f join messages m on m.id = f.message_id where f.created_at >= since), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_metrics_data(timestamptz) from public;
grant execute on function public.admin_metrics_data(timestamptz) to authenticated;
