begin;
create or replace function public.disconnect_gmail_sender() returns jsonb language plpgsql security definer set search_path=public,vault,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_secret_id uuid;
begin
if v_uid is null or not private.is_current_session() then raise exception 'Active signed-in session required'; end if;
delete from public.gmail_sender_profiles where user_id=v_uid returning credential_secret_id into v_secret_id;
if v_secret_id is not null then perform vault.delete_secret(v_secret_id); end if;
return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.disconnect_gmail_sender() from public,anon;
grant execute on function public.disconnect_gmail_sender() to authenticated;
do $$
declare v_def text;
begin
v_def:=pg_get_functiondef('public.save_sender_profile(text,text,text,integer,text,text,text,text,integer)'::regprocedure);
if position('private.is_current_session()' in v_def)=0 then v_def:=replace(v_def,'IF v_uid IS NULL THEN RAISE EXCEPTION ''Authentication required''; END IF;','IF v_uid IS NULL THEN RAISE EXCEPTION ''Authentication required''; END IF; IF NOT private.is_current_session() THEN RAISE EXCEPTION ''Active signed-in session required''; END IF;'); execute v_def; end if;
v_def:=pg_get_functiondef('public.save_resend_sender(text,text,integer)'::regprocedure);
if position('private.is_current_session()' in v_def)=0 then v_def:=replace(v_def,'IF v_uid IS NULL THEN RAISE EXCEPTION ''Authentication required''; END IF;','IF v_uid IS NULL THEN RAISE EXCEPTION ''Authentication required''; END IF; IF NOT private.is_current_session() THEN RAISE EXCEPTION ''Active signed-in session required''; END IF;'); execute v_def; end if;
v_def:=pg_get_functiondef('public.admin_review_subscription_payment(uuid,boolean,text)'::regprocedure);
if position('private.is_current_session()' in v_def)=0 then v_def:=replace(v_def,'if v_admin is null or not exists (','if v_admin is null or not private.is_current_session() or not exists ('); execute v_def; end if;
end; $$;
create or replace function public.admin_set_subscription(target_user_id uuid,new_plan_code text,new_status text,new_starts_at timestamptz,new_ends_at timestamptz,new_max_monthly_emails integer) returns public.subscriptions language plpgsql set search_path='' as $$
begin
if auth.uid() is null or not private.is_current_session() then raise exception 'Active signed-in session required'; end if;
return private.admin_set_subscription(target_user_id,new_plan_code,new_status,new_starts_at,new_ends_at,new_max_monthly_emails);
end; $$;
commit;