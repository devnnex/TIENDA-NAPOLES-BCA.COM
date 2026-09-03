begin;

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

  if trim($3) = '' or lower(trim($4)) !~ '^[a-z0-9._-]{3,40}$' then
    raise exception 'Nombre o usuario invalido.';
  end if;
  if $5 <> '' and $5 !~ '^[0-9]{4,12}$' then
    raise exception 'El PIN debe tener entre 4 y 12 digitos.';
  end if;

  select u.* into current_row
  from public.app_users u
  where u.id = $2;

  if current_row.id is null and $5 = '' then
    raise exception 'El PIN es obligatorio para un usuario nuevo.';
  end if;
  if current_row.role = 'admin' and ($6 <> 'admin' or not $7)
     and not exists (
       select 1 from public.app_users u
       where u.id <> current_row.id and u.role = 'admin' and u.is_active
     ) then
    raise exception 'No puedes desactivar o cambiar el rol del ultimo administrador.';
  end if;

  insert into public.app_users(id, full_name, username, pin_hash, role, is_active)
  values (
    $2,
    trim($3),
    lower(trim($4)),
    crypt($5, gen_salt('bf', 10)),
    case when $6 = 'admin' then 'admin' else 'waiter' end,
    $7
  )
  on conflict on constraint app_users_pkey do update set
    full_name = excluded.full_name,
    username = excluded.username,
    role = excluded.role,
    is_active = excluded.is_active,
    pin_hash = case when $5 <> '' then crypt($5, gen_salt('bf', 10)) else app_users.pin_hash end
  returning * into saved;

  return public.public_user(saved);
exception
  when unique_violation then
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

  select u.* into found_user
  from public.app_users u
  where u.username = normalized and u.is_active
  limit 1;

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

commit;
