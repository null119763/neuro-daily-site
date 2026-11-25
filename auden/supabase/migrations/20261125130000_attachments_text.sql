-- Attachments store extracted text only (no original file, no Storage bucket needed).
alter table public.attachments
  alter column path drop not null,
  add column message_id uuid references public.messages (id) on delete set null,
  add column name text not null default 'file' check (char_length(name) between 1 and 120),
  add column content text not null default '' check (char_length(content) <= 60000),
  add column chars integer not null default 0 check (chars >= 0),
  add column truncated boolean not null default false;
alter table public.attachments drop constraint attachments_size_check;
alter table public.attachments add constraint attachments_size_check check (size > 0 and size <= 4194304);
create index attachments_conversation_idx on public.attachments (conversation_id, created_at);

-- Ownership: the linked message must belong to the same user and conversation.
create or replace function public.check_attachment_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.message_id is not null and not exists (
    select 1 from messages m
    where m.id = new.message_id and m.user_id = new.user_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'message not owned by user' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger attachments_message_owner before insert or update on public.attachments
  for each row execute function public.check_attachment_owner();
