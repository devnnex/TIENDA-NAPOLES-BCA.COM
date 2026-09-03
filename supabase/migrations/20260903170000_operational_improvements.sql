-- Tienda Napoles - migracion operativa 2026-09-03
-- Archivo aditivo e idempotente. Ejecutar en el SQL Editor del proyecto actual.

begin;

alter table public.table_sessions add column if not exists sale_channel text not null default 'table';
alter table public.table_sessions alter column table_id drop not null;
alter table public.session_items alter column table_id drop not null;
alter table public.session_items add column if not exists created_by_user_id uuid;
alter table public.session_items add column if not exists updated_by_user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'table_sessions_sale_channel_check') then
    alter table public.table_sessions add constraint table_sessions_sale_channel_check check (sale_channel in ('table', 'walk_in'));
  end if;
end $$;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  table_id uuid references public.restaurant_tables(id) on delete cascade,
  sender_type text not null check (sender_type in ('client', 'staff', 'system')),
  sender_user_id uuid,
  sender_name text not null default '',
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx on public.chat_messages(session_id, created_at);
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;

create or replace function public.chat_staff_user(p_auth_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff jsonb;
begin
  if coalesce(p_auth_token, '') = '' then return null; end if;
  select to_jsonb(public.get_current_user(p_auth_token)) into staff;
  if coalesce((staff->>'is_active')::boolean, false) is not true then return null; end if;
  return staff;
exception when others then
  return null;
end;
$$;

create or replace function public.chat_client_can_access(p_table_id uuid, p_session_id uuid, p_table_access_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.valid_table_access(p_table_id, p_table_access_code) and exists (
    select 1
    from public.restaurant_tables rt
    join public.table_sessions ts on ts.table_id = rt.id
    where rt.id = p_table_id
      and ts.id = p_session_id
      and ts.status = 'open'
  );
$$;

create or replace function public.list_chat_messages(p_session_id uuid, p_table_id uuid default null, p_table_access_code text default '', p_auth_token text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff jsonb;
  result jsonb;
begin
  staff := public.chat_staff_user(p_auth_token);
  if staff is null and not public.chat_client_can_access(p_table_id, p_session_id, p_table_access_code) then
    raise exception 'Acceso al chat no autorizado';
  end if;
  select jsonb_build_object('messages', coalesce(jsonb_agg(to_jsonb(cm) order by cm.created_at), '[]'::jsonb))
    into result
  from public.chat_messages cm
  where cm.session_id = p_session_id;
  return result;
end;
$$;

create or replace function public.send_chat_message(p_message_id uuid, p_session_id uuid, p_table_id uuid default null, p_sender_type text default 'client', p_body text default '', p_table_access_code text default '', p_auth_token text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff jsonb;
  saved public.chat_messages;
  effective_sender text;
begin
  staff := public.chat_staff_user(p_auth_token);
  effective_sender := lower(coalesce(p_sender_type, 'client'));
  if effective_sender in ('staff', 'system') then
    if staff is null then raise exception 'Usuario administrativo no autorizado'; end if;
  elsif effective_sender = 'client' then
    if not public.chat_client_can_access(p_table_id, p_session_id, p_table_access_code) then raise exception 'Mesa no autorizada'; end if;
  else
    raise exception 'Remitente invalido';
  end if;
  insert into public.chat_messages(id, session_id, table_id, sender_type, sender_user_id, sender_name, body)
  values (
    coalesce(p_message_id, gen_random_uuid()), p_session_id, p_table_id, effective_sender,
    case when staff is null then null else nullif(staff->>'id', '')::uuid end,
    case when effective_sender = 'client' then 'Cliente' when effective_sender = 'system' then 'Sistema' else coalesce(staff->>'full_name', staff->>'username', 'Equipo') end,
    left(trim(p_body), 600)
  )
  on conflict (id) do update set body = excluded.body
  returning * into saved;
  return jsonb_build_object('message', to_jsonb(saved));
end;
$$;

create or replace function public.close_chat_session(p_session_id uuid, p_auth_token text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff jsonb;
  deleted_count integer;
begin
  staff := public.chat_staff_user(p_auth_token);
  if staff is null then raise exception 'Usuario administrativo no autorizado'; end if;
  delete from public.chat_messages cm where cm.session_id = p_session_id;
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('closed', true, 'deleted', deleted_count);
end;
$$;

grant execute on function public.list_chat_messages(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.send_chat_message(uuid, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.close_chat_session(uuid, text) to anon, authenticated;

do $$
declare
  category_name text;
  category_order integer := 100;
begin
  foreach category_name in array array['Snack', 'Bebidas', 'Medicina', 'Otros'] loop
    if not exists (select 1 from public.menu_categories mc where lower(mc.name) = lower(category_name)) then
      insert into public.menu_categories(name, sort_order, is_active) values (category_name, category_order, true);
    end if;
    category_order := category_order + 1;
  end loop;
end $$;

do $$
begin
  begin alter publication supabase_realtime add table public.service_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.table_sessions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.session_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end;
end $$;

commit;

