begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create table if not exists private.active_sessions(user_id uuid primary key references auth.users(id) on delete cascade,session_id uuid not null,updated_at timestamptz not null default now());
alter table private.active_sessions enable row level security;
revoke all on private.active_sessions from public, anon, authenticated;
create or replace function private.is_current_session() returns boolean language sql stable security definer set search_path=pg_catalog,private as $$
select exists(select 1 from private.active_sessions s where s.user_id=(select auth.uid()) and s.session_id::text=((select auth.jwt())->>'session_id'));
$$;
revoke all on function private.is_current_session() from public,anon;
grant execute on function private.is_current_session() to authenticated;
create or replace function public.claim_active_session() returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare v_uid uuid:=auth.uid(); v_session_id text:=auth.jwt()->>'session_id';
begin
if v_uid is null then raise exception 'Sign in required'; end if;
if v_session_id is null or v_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Session identifier is missing. Sign out and sign in again.'; end if;
insert into private.active_sessions(user_id,session_id,updated_at) values(v_uid,v_session_id::uuid,now()) on conflict(user_id) do update set session_id=excluded.session_id,updated_at=now();
return jsonb_build_object('ok',true,'single_active_session',true);
end; $$;
revoke all on function public.claim_active_session() from public,anon;
grant execute on function public.claim_active_session() to authenticated;
do $$
declare p record; v_using text; v_check text; v_sql text;
begin
for p in select schemaname,tablename,policyname,qual,with_check from pg_policies where schemaname='public' loop
v_using:=case when p.qual is null then null else '('||p.qual||') AND private.is_current_session()' end;
v_check:=case when p.with_check is null then null else '('||p.with_check||') AND private.is_current_session()' end;
v_sql:=format('ALTER POLICY %I ON %I.%I',p.policyname,p.schemaname,p.tablename);
if v_using is not null then v_sql:=v_sql||' USING ('||v_using||')'; end if;
if v_check is not null then v_sql:=v_sql||' WITH CHECK ('||v_check||')'; end if;
execute v_sql;
end loop;
end; $$;
commit;