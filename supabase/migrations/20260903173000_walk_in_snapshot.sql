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
