begin;
create table if not exists public.gmail_sender_profiles(user_id uuid primary key references auth.users(id) on delete cascade,gmail_email text not null,credential_secret_id uuid,credential_configured boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table public.gmail_sender_profiles enable row level security;
revoke all on public.gmail_sender_profiles from public,anon,authenticated;
grant select on public.gmail_sender_profiles to authenticated;
drop policy if exists "gmail profile owner reads own profile" on public.gmail_sender_profiles;
create policy "gmail profile owner reads own profile" on public.gmail_sender_profiles for select to authenticated using(user_id=(select auth.uid()) and private.is_current_session());
create or replace function public.service_store_gmail_credentials(p_user_id uuid,p_gmail_email text,p_payload text) returns jsonb language plpgsql security definer set search_path=public,vault,pg_temp as $$
declare v_secret_id uuid; v_email text:=lower(trim(coalesce(p_gmail_email,'')));
begin
if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
if p_user_id is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Valid user and Gmail address required'; end if;
if p_payload is null or length(p_payload)<20 then raise exception 'Credential payload is invalid'; end if;
select credential_secret_id into v_secret_id from public.gmail_sender_profiles where user_id=p_user_id;
if v_secret_id is null then
v_secret_id:=vault.create_secret(p_payload,'send-mail-now:gmail:'||p_user_id::text,'Encrypted Gmail API OAuth credentials',NULL);
insert into public.gmail_sender_profiles(user_id,gmail_email,credential_secret_id,credential_configured,updated_at) values(p_user_id,v_email,v_secret_id,true,now())
on conflict(user_id) do update set gmail_email=excluded.gmail_email,credential_secret_id=excluded.credential_secret_id,credential_configured=true,updated_at=now();
else
perform vault.update_secret(v_secret_id,p_payload,NULL,'Encrypted Gmail API OAuth credentials',NULL);
update public.gmail_sender_profiles set gmail_email=v_email,credential_configured=true,updated_at=now() where user_id=p_user_id;
end if;
return jsonb_build_object('ok',true,'gmail_email',v_email);
end; $$;
create or replace function public.service_get_gmail_secret(p_user_id uuid) returns text language plpgsql security definer set search_path=public,vault,pg_temp as $$
declare v_secret text;
begin
if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
select ds.decrypted_secret into v_secret from public.gmail_sender_profiles gp join vault.decrypted_secrets ds on ds.id=gp.credential_secret_id where gp.user_id=p_user_id and gp.credential_configured=true;
if v_secret is null then raise exception 'Gmail API is not connected'; end if;
return v_secret;
end; $$;
revoke all on function public.service_store_gmail_credentials(uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_store_gmail_credentials(uuid,text,text) to service_role;
revoke all on function public.service_get_gmail_secret(uuid) from public,anon,authenticated;
grant execute on function public.service_get_gmail_secret(uuid) to service_role;
commit;