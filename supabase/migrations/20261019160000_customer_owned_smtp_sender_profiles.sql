-- Customer-owned sender credentials; secrets are stored only in Supabase Vault.
ALTER TABLE public.smtp_profiles ADD COLUMN IF NOT EXISTS from_email text;

CREATE OR REPLACE FUNCTION public.save_sender_profile(
  p_provider text, p_from_email text, p_host text DEFAULT NULL, p_port integer DEFAULT 587,
  p_username text DEFAULT NULL, p_password text DEFAULT NULL, p_api_key text DEFAULT NULL,
  p_secure_mode text DEFAULT 'starttls', p_hourly_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_profile_id uuid; v_secret_id uuid; v_payload text;
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_from text := lower(trim(coalesce(p_from_email, '')));
  v_label text; v_host text; v_port integer; v_username text; v_mode text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_from !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN RAISE EXCEPTION 'Enter a valid sender email address'; END IF;
  IF p_hourly_limit IS NULL OR p_hourly_limit < 1 OR p_hourly_limit > 1000 THEN RAISE EXCEPTION 'Hourly limit must be between 1 and 1000'; END IF;
  IF v_provider = 'resend' THEN
    IF p_api_key IS NULL OR length(trim(p_api_key)) < 20 OR trim(p_api_key) NOT LIKE 're\_%' ESCAPE '\' THEN RAISE EXCEPTION 'Enter a valid Resend API key'; END IF;
    v_label := 'Resend API'; v_host := 'api.resend.com'; v_port := 443; v_username := v_from; v_mode := 'tls';
    v_payload := jsonb_build_object('provider','resend','api_key',trim(p_api_key),'from_email',v_from)::text;
  ELSIF v_provider = 'smtp' THEN
    v_host := lower(trim(coalesce(p_host,''))); v_port := coalesce(p_port,587); v_username := trim(coalesce(p_username,'')); v_mode := lower(trim(coalesce(p_secure_mode,'starttls')));
    IF v_host !~ '^[a-z0-9.-]+$' OR position('..' in v_host)>0 OR v_host LIKE '.%' OR v_host LIKE '%.' OR v_host IN ('localhost','localhost.localdomain') OR v_host ~ '^[0-9]+[.]' OR v_host LIKE '%.local' OR v_host LIKE '%.internal' THEN RAISE EXCEPTION 'Enter a public SMTP hostname, such as smtp.gmail.com'; END IF;
    IF v_port < 1 OR v_port > 65535 THEN RAISE EXCEPTION 'SMTP port must be between 1 and 65535'; END IF;
    IF v_username = '' THEN RAISE EXCEPTION 'SMTP username is required'; END IF;
    IF p_password IS NULL OR length(p_password) < 1 THEN RAISE EXCEPTION 'SMTP password or app password is required'; END IF;
    IF v_mode NOT IN ('ssl','starttls','tls') THEN RAISE EXCEPTION 'Security mode must be SSL or STARTTLS'; END IF;
    v_label := 'Customer SMTP'; v_payload := jsonb_build_object('provider','smtp','password',p_password,'from_email',v_from)::text;
  ELSE RAISE EXCEPTION 'Provider must be smtp or resend';
  END IF;
  SELECT id,credential_secret_id INTO v_profile_id,v_secret_id FROM public.smtp_profiles WHERE user_id=v_uid AND label=v_label ORDER BY created_at LIMIT 1;
  IF v_profile_id IS NULL THEN
    v_profile_id := gen_random_uuid();
    v_secret_id := vault.create_secret(v_payload,'send-mail-now:'||v_uid::text||':'||v_profile_id::text,'Encrypted customer sender credential',NULL);
    INSERT INTO public.smtp_profiles(id,user_id,label,host,port,username,secure_mode,hourly_limit,batch_size,enabled,credential_secret_id,credential_configured,from_email)
    VALUES(v_profile_id,v_uid,v_label,v_host,v_port,v_username,v_mode,p_hourly_limit,20,true,v_secret_id,true,v_from);
  ELSE
    IF v_secret_id IS NULL THEN v_secret_id := vault.create_secret(v_payload,'send-mail-now:'||v_uid::text||':'||v_profile_id::text,'Encrypted customer sender credential',NULL);
    ELSE PERFORM vault.update_secret(v_secret_id,v_payload,NULL,'Encrypted customer sender credential',NULL); END IF;
    UPDATE public.smtp_profiles SET host=v_host,port=v_port,username=v_username,secure_mode=v_mode,hourly_limit=p_hourly_limit,batch_size=20,enabled=true,credential_secret_id=v_secret_id,credential_configured=true,from_email=v_from,updated_at=now() WHERE id=v_profile_id AND user_id=v_uid;
  END IF;
  RETURN jsonb_build_object('id',v_profile_id,'label',v_label,'provider',v_provider,'from_email',v_from,'host',v_host,'port',v_port,'username',v_username,'secure_mode',v_mode,'credential_configured',true,'hourly_limit',p_hourly_limit);
END; $$;

CREATE OR REPLACE FUNCTION public.service_get_sender_secret(p_profile_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, pg_temp AS $$
DECLARE v_secret text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT ds.decrypted_secret INTO v_secret FROM public.smtp_profiles sp JOIN vault.decrypted_secrets ds ON ds.id=sp.credential_secret_id
  WHERE sp.id=p_profile_id AND sp.enabled=true AND sp.credential_configured=true;
  IF v_secret IS NULL THEN RAISE EXCEPTION 'Sender credentials are not configured'; END IF;
  RETURN v_secret;
END; $$;

REVOKE ALL ON FUNCTION public.save_sender_profile(text,text,text,integer,text,text,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_sender_profile(text,text,text,integer,text,text,text,text,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.service_get_sender_secret(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_sender_secret(uuid) TO service_role;