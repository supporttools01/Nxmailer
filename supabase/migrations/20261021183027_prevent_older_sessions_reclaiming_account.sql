begin;
alter table private.active_sessions disable row level security;
create or replace function public.claim_active_session() returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare v_uid uuid:=auth.uid(); v_session_text text:=auth.jwt()->>'session_id'; v_session uuid; v_current_created timestamptz; v_active_session uuid; v_active_created timestamptz;
begin
if v_uid is null then raise exception 'Sign in required'; end if;
if v_session_text is null or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Session identifier is missing. Sign out and sign in again.'; end if;
v_session:=v_session_text::uuid;
select s.created_at into v_current_created from auth.sessions s where s.id=v_session and s.user_id=v_uid;
if v_current_created is null then raise exception 'Session is no longer valid. Sign in again.'; end if;
select a.session_id,s.created_at into v_active_session,v_active_created from private.active_sessions a left join auth.sessions s on s.id=a.session_id where a.user_id=v_uid;
if v_active_session is not null and v_active_session<>v_session and v_active_created is not null and v_current_created<=v_active_created then raise exception 'This account is already active in another session. Sign out there or sign in with a newer session.'; end if;
insert into private.active_sessions(user_id,session_id,updated_at) values(v_uid,v_session,now()) on conflict(user_id) do update set session_id=excluded.session_id,updated_at=now();
return jsonb_build_object('ok',true,'single_active_session',true);
end; $$;
revoke all on function public.claim_active_session() from public,anon;
grant execute on function public.claim_active_session() to authenticated;
commit;