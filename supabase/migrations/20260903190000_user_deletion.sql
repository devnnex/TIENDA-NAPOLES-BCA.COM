begin;

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

commit;
