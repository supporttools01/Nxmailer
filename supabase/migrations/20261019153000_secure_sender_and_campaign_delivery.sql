-- Prevent users from promoting themselves or modifying protected profile fields.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (display_name, company_name) ON TABLE public.profiles TO authenticated;

-- SMTP metadata is read-only from the browser until a credential-vault RPC is wired in.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.smtp_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.smtp_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.save_resend_sender(
  p_from_email text,
  p_api_key text,
  p_hourly_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_secret_id uuid;
  v_payload text;
  v_from text := lower(trim(coalesce(p_from_email, '')));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_from !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid sender email address';
  END IF;
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 20 OR trim(p_api_key) NOT LIKE 're\_%' ESCAPE '\' THEN
    RAISE EXCEPTION 'Enter a valid Resend API key';
  END IF;
  IF p_hourly_limit IS NULL OR p_hourly_limit < 1 OR p_hourly_limit > 1000 THEN
    RAISE EXCEPTION 'Hourly limit must be between 1 and 1000';
  END IF;

  v_payload := jsonb_build_object('provider','resend','api_key',trim(p_api_key),'from_email',v_from)::text;
  SELECT id, credential_secret_id INTO v_profile_id, v_secret_id
  FROM public.smtp_profiles
  WHERE user_id = v_uid AND label = 'Resend API'
  ORDER BY created_at LIMIT 1;

  IF v_profile_id IS NULL THEN
    v_profile_id := gen_random_uuid();
    v_secret_id := vault.create_secret(v_payload, 'send-mail-now:' || v_uid::text || ':' || v_profile_id::text, 'Encrypted Resend API sender credential', NULL);
    INSERT INTO public.smtp_profiles (
      id,user_id,label,host,port,username,secure_mode,hourly_limit,batch_size,enabled,credential_secret_id,credential_configured
    ) VALUES (
      v_profile_id,v_uid,'Resend API','api.resend.com',443,v_from,'tls',p_hourly_limit,20,true,v_secret_id,true
    );
  ELSE
    IF v_secret_id IS NULL THEN
      v_secret_id := vault.create_secret(v_payload, 'send-mail-now:' || v_uid::text || ':' || v_profile_id::text, 'Encrypted Resend API sender credential', NULL);
    ELSE
      PERFORM vault.update_secret(v_secret_id,v_payload,NULL,'Encrypted Resend API sender credential',NULL);
    END IF;
    UPDATE public.smtp_profiles SET
      host='api.resend.com',port=443,username=v_from,secure_mode='tls',
      hourly_limit=p_hourly_limit,batch_size=20,enabled=true,
      credential_secret_id=v_secret_id,credential_configured=true,updated_at=now()
    WHERE id=v_profile_id AND user_id=v_uid;
  END IF;

  RETURN jsonb_build_object('id',v_profile_id,'label','Resend API','from_email',v_from,'credential_configured',true,'hourly_limit',p_hourly_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_get_resend_secret(p_profile_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE v_secret text;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  SELECT ds.decrypted_secret INTO v_secret
  FROM public.smtp_profiles sp
  JOIN vault.decrypted_secrets ds ON ds.id=sp.credential_secret_id
  WHERE sp.id=p_profile_id AND sp.enabled=true AND sp.credential_configured=true;
  IF v_secret IS NULL THEN RAISE EXCEPTION 'Sender credentials are not configured'; END IF;
  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.save_resend_sender(text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_resend_sender(text,text,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.service_get_resend_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_resend_secret(uuid) TO service_role;

ALTER TABLE public.campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;
ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]));
