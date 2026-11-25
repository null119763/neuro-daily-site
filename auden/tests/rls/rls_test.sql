-- RLS tests: two users must never see or modify each other's data.
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  execute 'set role authenticated';
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev', '{"display_name":"Alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev', '{}');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'profiles auto-created';
  assert (select display_name from public.profiles where email = 'a@test.dev') = 'Alice', 'display name copied';
end $$;

-- Alice creates data
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into public.projects (id, user_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', auth.uid(), 'A project');
insert into public.conversations (id, user_id, project_id, title) values ('aaaaaaaa-0000-0000-0000-000000000002', auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'A chat');
insert into public.messages (conversation_id, user_id, role, content) values ('aaaaaaaa-0000-0000-0000-000000000002', auth.uid(), 'user', 'secret of alice');
insert into public.memories (user_id, content, source, consent) values (auth.uid(), 'alice likes tea', 'manual', true);
insert into public.usage_events (user_id, provider, model) values (auth.uid(), 'mock', 'mock-core');
reset role;

-- Bob sees nothing of Alice
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'bob sees only own profile';
  assert (select count(*) from public.projects) = 0, 'bob cannot see projects';
  assert (select count(*) from public.conversations) = 0, 'bob cannot see conversations';
  assert (select count(*) from public.messages) = 0, 'bob cannot see messages';
  assert (select count(*) from public.memories) = 0, 'bob cannot see memories';
  assert (select count(*) from public.usage_events) = 0, 'bob cannot see usage';
end $$;

-- Bob cannot modify Alice's rows (0 rows affected)
update public.messages set content = 'hacked';
delete from public.conversations;
delete from public.memories;

do $$ begin
  -- Bob cannot insert rows owned by Alice
  begin
    insert into public.projects (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'forged');
    raise exception 'forged insert should fail';
  exception when insufficient_privilege then null;
  end;
  -- Bob cannot attach a message to Alice's conversation even with his own user_id
  begin
    insert into public.messages (conversation_id, user_id, role, content)
      values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'user', 'x');
    raise exception 'cross-owner message should fail';
  exception when insufficient_privilege then null;
  end;
  -- Bob cannot put his conversation into Alice's project
  begin
    insert into public.conversations (user_id, project_id, title)
      values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'x');
    raise exception 'cross-owner project should fail';
  exception when insufficient_privilege then null;
  end;
  -- Bob cannot change his profile email
  begin
    update public.profiles set email = 'evil@test.dev';
    raise exception 'email change should fail';
  exception when insufficient_privilege then null;
  end;
  -- Usage with non-zero cost cannot be recorded through the user's JWT
  begin
    insert into public.usage_events (user_id, provider, model, cost) values ('22222222-2222-2222-2222-222222222222', 'x', 'y', 5);
    raise exception 'costed usage insert should fail';
  exception when insufficient_privilege then null;
  end;
  -- Global aggregate is visible without exposing per-user rows
  assert (select requests from public.global_usage_since(now() - interval '1 day', 10)) = 1, 'global usage aggregate';
  -- Flooding: Bob inserts many rows directly; his contribution is capped
  insert into public.usage_events (user_id, provider, model) select '22222222-2222-2222-2222-222222222222', 'x', 'y' from generate_series(1, 50);
  assert (select requests from public.global_usage_since(now() - interval '1 day', 10)) = 11, 'per-user cap applied';
end $$;
reset role;

-- Alice: data intact; cannot delete usage (quota reset protection)
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
do $$ begin
  assert (select content from public.messages limit 1) = 'secret of alice', 'alice message intact';
  assert (select count(*) from public.memories) = 1, 'alice memory intact';
  assert (select count(*) from public.conversations) = 1, 'alice conversation intact';
  begin
    delete from public.usage_events;
    raise exception 'usage delete should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Deleting a conversation cascades its messages
delete from public.conversations where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin
  assert (select count(*) from public.messages) = 0, 'messages cascade with conversation';
end $$;

-- Account deletion removes everything owned
select public.delete_my_account();
reset role;
do $$ begin
  assert (select count(*) from auth.users where email = 'a@test.dev') = 0, 'auth user removed';
  assert (select count(*) from public.projects) = 0, 'projects removed';
  assert (select count(*) from public.memories) = 0, 'memories removed';
  assert (select count(*) from public.usage_events where user_id is null) = 1, 'usage anonymised, kept for accounting';
  assert (select cost from public.global_usage_since(now() - interval '1 day', 10)) = 0, 'no cost recorded';
end $$;

-- Unauthenticated requests see nothing
select pg_temp.as_user(null);
do $$ begin
  assert (select count(*) from public.profiles) = 0, 'unauthenticated sees nothing';
end $$;
reset role;
-- Sign-up modes are enforced by the database
update public.app_config set value = 'allowlist' where key = 'signup_mode';
insert into public.signup_allowlist (entry) values ('invited@test.dev'), ('@team.dev');
insert into auth.users (email) values ('invited@test.dev'), ('anyone@team.dev');
do $$ begin
  begin
    insert into auth.users (email) values ('stranger@test.dev');
    raise exception 'uninvited sign-up should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.app_config set value = 'closed' where key = 'signup_mode';
do $$ begin
  begin
    insert into auth.users (email) values ('late@team.dev');
    raise exception 'closed sign-up should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Clients cannot read or change the allowlist or the mode
select pg_temp.as_user((select id from auth.users where email = 'invited@test.dev'));
do $$ begin
  begin
    perform 1 from public.signup_allowlist;
    raise exception 'allowlist should not be readable';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.app_config set value = 'open';
    raise exception 'config should not be writable';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.app_config set value = 'open' where key = 'signup_mode';
\echo 'RLS tests passed'
