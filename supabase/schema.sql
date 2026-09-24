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

create or replace function public.get_admin_snapshot(auth_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_app_user(auth_token);
  return jsonb_build_object(
    'requests', (
      select coalesce(jsonb_agg(
        to_jsonb(r) || jsonb_build_object(
          'restaurant_tables', jsonb_build_object('table_number', t.table_number, 'table_name', t.table_name),
          'acknowledged_by_user', case when u.id is null then null else public.public_user(u) end
        ) order by r.created_at desc), '[]'::jsonb)
      from public.service_requests r
      join public.restaurant_tables t on t.id = r.table_id
      left join public.app_users u on u.id = r.acknowledged_by_user_id
      where r.status in ('pending', 'acknowledged')
    ),
    'sessions', (
      select coalesce(jsonb_agg(
        to_jsonb(s) || jsonb_build_object(
          'restaurant_tables', case when t.id is null then null else jsonb_build_object('table_number', t.table_number, 'table_name', t.table_name) end,
          'assigned_waiter', case when u.id is null then null else public.public_user(u) end,
          'session_items', (
            select coalesce(jsonb_agg(
              to_jsonb(i) || jsonb_build_object('created_by_user', case when cu.id is null then null else public.public_user(cu) end)
              order by i.created_at
            ), '[]'::jsonb)
            from public.session_items i
            left join public.app_users cu on cu.id = i.created_by_user_id
            where i.session_id = s.id
          )
        ) order by s.opened_at desc), '[]'::jsonb)
      from public.table_sessions s
      left join public.restaurant_tables t on t.id = s.table_id
      left join public.app_users u on u.id = s.assigned_waiter_id
      where s.status = 'open'
    )
  );
end;
$$;

grant execute on function public.get_admin_snapshot(text) to anon, authenticated;

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

-- Administracion segura de usuarios. Las relaciones operativas usan ON DELETE
-- SET NULL y el historico de Apps Script conserva el nombre del responsable.
create or replace function public.delete_user(auth_token text, user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.app_users;
  target public.app_users;
begin
  actor := public.require_admin(auth_token);
  select * into target from public.app_users where id = user_id;
  if target.id is null then return jsonb_build_object('deleted', false, 'reason', 'not_found'); end if;
  if target.id = actor.id then raise exception 'No puedes eliminar tu propio usuario mientras tienes la sesion abierta.'; end if;
  if target.role = 'admin' and target.is_active
     and not exists(select 1 from public.app_users u where u.id <> target.id and u.role = 'admin' and u.is_active) then
    raise exception 'No puedes eliminar el ultimo administrador activo.';
  end if;
  delete from public.app_users where id = target.id;
  return jsonb_build_object('deleted', true, 'id', target.id, 'full_name', target.full_name);
end;
$$;

grant execute on function public.delete_user(text, uuid) to anon, authenticated;

-- Correccion de administracion de usuarios: usa parametros posicionales para
-- evitar ambiguedades entre el parametro id y la columna app_users.id.
create or replace function public.save_user(
  auth_token text,
  id uuid,
  full_name text,
  username text,
  pin text default '',
  role text default 'waiter',
  is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  saved public.app_users;
  current_row public.app_users;
begin
  perform public.require_admin($1);
  if trim($3) = '' or lower(trim($4)) !~ '^[a-z0-9._-]{3,40}$' then raise exception 'Nombre o usuario invalido.'; end if;
  if $5 <> '' and $5 !~ '^[0-9]{4,12}$' then raise exception 'El PIN debe tener entre 4 y 12 digitos.'; end if;
  select u.* into current_row from public.app_users u where u.id = $2;
  if current_row.id is null and $5 = '' then raise exception 'El PIN es obligatorio para un usuario nuevo.'; end if;
  if current_row.role = 'admin' and ($6 <> 'admin' or not $7)
     and not exists(select 1 from public.app_users u where u.id <> current_row.id and u.role = 'admin' and u.is_active) then
    raise exception 'No puedes desactivar o cambiar el rol del ultimo administrador.';
  end if;
  insert into public.app_users(id, full_name, username, pin_hash, role, is_active)
  values ($2, trim($3), lower(trim($4)), crypt($5, gen_salt('bf', 10)), case when $6 = 'admin' then 'admin' else 'waiter' end, $7)
  on conflict on constraint app_users_pkey do update set
    full_name = excluded.full_name, username = excluded.username, role = excluded.role, is_active = excluded.is_active,
    pin_hash = case when $5 <> '' then crypt($5, gen_salt('bf', 10)) else app_users.pin_hash end
  returning * into saved;
  return public.public_user(saved);
exception when unique_violation then
  raise exception 'Ese nombre de usuario ya esta en uso.';
end;
$$;

grant execute on function public.save_user(text, uuid, text, text, text, text, boolean) to anon, authenticated;

create or replace function public.login(username text, pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized text := lower(trim($1));
  found_user public.app_users;
  attempt public.login_attempts;
  raw_token text;
  expiry timestamptz := now() + interval '12 hours';
begin
  select a.* into attempt from public.login_attempts a where a.username = normalized;
  if attempt.blocked_until > now() then return null; end if;
  select u.* into found_user from public.app_users u where u.username = normalized and u.is_active limit 1;
  if found_user.id is null or crypt($2, found_user.pin_hash) <> found_user.pin_hash then
    insert into public.login_attempts(username, attempts, blocked_until)
    values (normalized, 1, null)
    on conflict on constraint login_attempts_pkey do update set
      attempts = case when login_attempts.blocked_until <= now() then 1 else login_attempts.attempts + 1 end,
      blocked_until = case when login_attempts.attempts + 1 >= 8 then now() + interval '5 minutes' else login_attempts.blocked_until end,
      updated_at = now();
    return null;
  end if;
  delete from public.login_attempts a where a.username = normalized;
  delete from public.auth_sessions s where s.expires_at <= now();
  raw_token := encode(gen_random_bytes(32), 'hex');
  insert into public.auth_sessions(user_id, token_hash, expires_at)
  values (found_user.id, encode(digest(raw_token, 'sha256'), 'hex'), expiry);
  update public.app_users u set last_login_at = now() where u.id = found_user.id returning u.* into found_user;
  return jsonb_build_object('token', raw_token, 'expires_at', expiry, 'user', public.public_user(found_user));
end;
$$;

grant execute on function public.login(text, text) to anon, authenticated;

-- Roles Jefe / Administrador / Mesero y permisos por sección.
-- Convierte los administradores existentes en Jefes para conservar el acceso total.

begin;

alter table public.app_users
  add column if not exists permissions jsonb not null default '[]'::jsonb;

alter table public.app_users drop constraint if exists app_users_role_check;
update public.app_users set role = 'boss' where role = 'admin';
alter table public.app_users
  add constraint app_users_role_check check (role in ('boss', 'admin', 'waiter'));

create or replace function public.public_user(user_value public.app_users)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'id', user_value.id,
    'full_name', user_value.full_name,
    'username', user_value.username,
    'role', user_value.role,
    'permissions', coalesce(user_value.permissions, '[]'::jsonb),
    'is_active', user_value.is_active,
    'last_login_at', user_value.last_login_at,
    'created_at', user_value.created_at,
    'updated_at', user_value.updated_at
  );
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((public.app_user_for_token(public.request_header('x-app-token'))).role in ('boss', 'admin'), false);
$$;

create or replace function public.app_is_boss()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((public.app_user_for_token(public.request_header('x-app-token'))).role = 'boss', false);
$$;

create or replace function public.app_can_access_section(section_name text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when (staff).id is null then false
    when (staff).role = 'boss' then true
    when (staff).role <> 'admin' then section_name = 'service'
    else coalesce((staff).permissions, '[]'::jsonb) ? section_name
  end
  from (select public.app_user_for_token(public.request_header('x-app-token')) as staff) current_staff;
$$;

create or replace function public.require_boss(token text)
returns public.app_users
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare result public.app_users;
begin
  result := public.require_app_user(token);
  if result.role <> 'boss' then raise exception 'Permiso exclusivo del Jefe.'; end if;
  return result;
end;
$$;

-- Las funciones administrativas históricas pasan a ser exclusivas del Jefe.
create or replace function public.require_admin(token text)
returns public.app_users
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return public.require_boss(token);
end;
$$;

create or replace function public.list_users(auth_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.require_boss(auth_token);
  return (select coalesce(jsonb_agg(public.public_user(u) order by u.full_name), '[]'::jsonb) from public.app_users u);
end;
$$;

drop function if exists public.save_user(text, uuid, text, text, text, text, boolean);

create function public.save_user(
  auth_token text,
  id uuid,
  full_name text,
  username text,
  pin text default '',
  role text default 'waiter',
  is_active boolean default true,
  permissions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  saved public.app_users;
  current_row public.app_users;
  clean_role text := case when $6 in ('boss', 'admin', 'waiter') then $6 else 'waiter' end;
  clean_permissions jsonb := case when $6 = 'admin' and jsonb_typeof(coalesce($8, '[]'::jsonb)) = 'array' then coalesce($8, '[]'::jsonb) else '[]'::jsonb end;
begin
  perform public.require_boss($1);
  if trim($3) = '' or lower(trim($4)) !~ '^[a-z0-9._-]{3,40}$' then raise exception 'Nombre o usuario invalido.'; end if;
  if $5 <> '' and $5 !~ '^[0-9]{4,12}$' then raise exception 'El PIN debe tener entre 4 y 12 digitos.'; end if;
  if clean_role = 'admin' and jsonb_array_length(clean_permissions) = 0 then raise exception 'Selecciona al menos una seccion para el Administrador.'; end if;

  select u.* into current_row from public.app_users u where u.id = $2;
  if current_row.id is null and $5 = '' then raise exception 'El PIN es obligatorio para un usuario nuevo.'; end if;
  if current_row.role = 'boss' and (clean_role <> 'boss' or not $7)
     and not exists(select 1 from public.app_users u where u.id <> current_row.id and u.role = 'boss' and u.is_active) then
    raise exception 'No puedes desactivar o cambiar el rol del ultimo Jefe.';
  end if;

  insert into public.app_users(id, full_name, username, pin_hash, role, is_active, permissions)
  values ($2, trim($3), lower(trim($4)), crypt($5, gen_salt('bf', 10)), clean_role, $7, clean_permissions)
  on conflict on constraint app_users_pkey do update set
    full_name = excluded.full_name,
    username = excluded.username,
    role = excluded.role,
    is_active = excluded.is_active,
    permissions = excluded.permissions,
    pin_hash = case when $5 <> '' then crypt($5, gen_salt('bf', 10)) else app_users.pin_hash end
  returning * into saved;
  return public.public_user(saved);
exception when unique_violation then
  raise exception 'Ese nombre de usuario ya esta en uso.';
end;
$$;

create or replace function public.delete_user(auth_token text, user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare actor public.app_users; target public.app_users;
begin
  actor := public.require_boss(auth_token);
  select * into target from public.app_users where id = user_id;
  if target.id is null then return jsonb_build_object('deleted', false, 'reason', 'not_found'); end if;
  if target.id = actor.id then raise exception 'No puedes eliminar tu propio usuario mientras tienes la sesion abierta.'; end if;
  if target.role = 'boss' and target.is_active
     and not exists(select 1 from public.app_users u where u.id <> target.id and u.role = 'boss' and u.is_active) then
    raise exception 'No puedes eliminar el ultimo Jefe activo.';
  end if;
  delete from public.app_users where id = target.id;
  return jsonb_build_object('deleted', true, 'id', target.id, 'full_name', target.full_name);
end;
$$;

grant execute on function public.app_is_boss() to anon, authenticated;
grant execute on function public.app_can_access_section(text) to anon, authenticated;
revoke all on function public.require_boss(text) from public, anon, authenticated;
grant execute on function public.save_user(text, uuid, text, text, text, text, boolean, jsonb) to anon, authenticated;

-- Separa crear/editar de eliminar: Administrador puede operar sus secciones,
-- pero únicamente Jefe puede borrar datos.
drop policy if exists admin_business_all on public.business_settings;
drop policy if exists admin_categories_all on public.menu_categories;
drop policy if exists admin_items_all on public.menu_items;
drop policy if exists admin_tables_all on public.restaurant_tables;

create policy staff_business_insert on public.business_settings for insert to anon with check (public.app_can_access_section('brand'));
create policy staff_business_update on public.business_settings for update to anon using (public.app_can_access_section('brand')) with check (public.app_can_access_section('brand'));
create policy boss_business_delete on public.business_settings for delete to anon using (public.app_is_boss());

create policy staff_categories_insert on public.menu_categories for insert to anon with check (public.app_can_access_section('menu') or public.app_can_access_section('inventory'));
create policy staff_categories_update on public.menu_categories for update to anon using (public.app_can_access_section('menu') or public.app_can_access_section('inventory')) with check (public.app_can_access_section('menu') or public.app_can_access_section('inventory'));
create policy boss_categories_delete on public.menu_categories for delete to anon using (public.app_is_boss());

create policy staff_items_insert on public.menu_items for insert to anon with check (public.app_can_access_section('menu') or public.app_can_access_section('inventory'));
create policy staff_items_update on public.menu_items for update to anon using (public.app_can_access_section('menu') or public.app_can_access_section('inventory')) with check (public.app_can_access_section('menu') or public.app_can_access_section('inventory'));
create policy boss_menu_items_delete on public.menu_items for delete to anon using (public.app_is_boss());

create policy staff_tables_insert on public.restaurant_tables for insert to anon with check (public.app_can_access_section('menu'));
create policy staff_tables_update on public.restaurant_tables for update to anon using (public.app_can_access_section('menu')) with check (public.app_can_access_section('menu'));
create policy boss_tables_delete on public.restaurant_tables for delete to anon using (public.app_is_boss());

drop policy if exists staff_items_delete on public.session_items;
drop policy if exists staff_requests_delete on public.service_requests;
drop policy if exists staff_sessions_delete on public.table_sessions;
create policy boss_session_items_delete on public.session_items for delete to anon using (public.app_is_boss());
create policy boss_service_requests_delete on public.service_requests for delete to anon using (public.app_is_boss());
create policy boss_table_sessions_delete on public.table_sessions for delete to anon using (public.app_is_boss());

create or replace function public.enforce_staff_mutation_limits()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare actor public.app_users;
begin
  actor := public.app_user_for_token(public.request_header('x-app-token'));
  if actor.id is null then return new; end if;
  if tg_table_name = 'session_items' and new.status = 'cancelled' and old.status is distinct from new.status and actor.role <> 'boss' then
    raise exception 'Solo el Jefe puede eliminar consumos.';
  end if;
  if tg_table_name = 'table_sessions' and actor.role = 'waiter' and new.status is distinct from old.status then
    raise exception 'El Mesero solo puede agregar o editar consumos.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_session_item_role_limits on public.session_items;
create trigger enforce_session_item_role_limits before update on public.session_items
for each row execute function public.enforce_staff_mutation_limits();

drop trigger if exists enforce_table_session_role_limits on public.table_sessions;
create trigger enforce_table_session_role_limits before update on public.table_sessions
for each row execute function public.enforce_staff_mutation_limits();

commit;

