-- Prevent users from promoting themselves or modifying protected profile fields.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (display_name, company_name) ON TABLE public.profiles TO authenticated;

-- SMTP metadata is read-only from the browser until a credential-vault RPC is wired in.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.smtp_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.smtp_profiles TO authenticated;
