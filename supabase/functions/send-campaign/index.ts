import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
);
const personalize = (input: string, data: Record<string, unknown>) =>
  input.replace(/{{\s*([\w.-]+)\s*}}/g, (_m, key) => escapeHtml(data[key] ?? data[key.toLowerCase()] ?? ""));

const base64UrlUtf8 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return reply({ error: "Sender service environment is not configured" }, 500);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Sign in required" }, 401);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const serviceClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const user = authData?.user;
    if (authError || !user) return reply({ error: "Session expired. Sign in again." }, 401);

    const body = await req.json().catch(() => ({}));
    if (body.action === "test") {
      const { data: gmailTestProfile } = await userClient.from("gmail_sender_profiles")
        .select("user_id,gmail_email,credential_configured").eq("user_id", user.id).eq("credential_configured", true).maybeSingle();
      if (gmailTestProfile) {
        const { data: gmailSecretText, error: gmailSecretError } = await serviceClient.rpc("service_get_gmail_secret", { p_user_id: user.id });
        if (gmailSecretError || !gmailSecretText) return reply({ error: "Gmail API credentials could not be loaded securely." }, 500);
        let gmailSecret: any;
        try { gmailSecret = JSON.parse(gmailSecretText); } catch { return reply({ error: "Gmail credential format is invalid." }, 500); }
        if (Number(gmailSecret.expires_at || 0) < Date.now() + 60000) {
          const clientId = Deno.env.get("GOOGLE_CLIENT_ID"), clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
          if (!clientId || !clientSecret || !gmailSecret.refresh_token) return reply({ error: "Google OAuth refresh credentials are not configured." }, 503);
          const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: gmailSecret.refresh_token, grant_type: "refresh_token" }) });
          const refreshed = await tokenResponse.json().catch(() => ({}));
          if (!tokenResponse.ok || !refreshed.access_token) return reply({ error: "Gmail access token refresh failed. Reconnect your Google account." }, 401);
          gmailSecret = { ...gmailSecret, access_token: refreshed.access_token, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 };
          const saved = await serviceClient.rpc("service_store_gmail_credentials", { p_user_id: user.id, p_gmail_email: gmailTestProfile.gmail_email, p_payload: JSON.stringify(gmailSecret) });
          if (saved.error) return reply({ error: "Could not securely refresh Gmail credentials." }, 500);
        }
        const check = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + gmailSecret.access_token } });
        if (!check.ok) return reply({ error: "Gmail API rejected the connection (HTTP " + check.status + "). Reconnect Gmail." }, 400);
        return reply({ ok: true, message: "Gmail API authenticated successfully for " + gmailTestProfile.gmail_email + ". No email was sent." });
      }
      const { data: testSender, error: testSenderError } = await userClient.from("smtp_profiles")
        .select("id,label,host,port,username,secure_mode,enabled,credential_configured,from_email")
        .eq("user_id", user.id).eq("enabled", true).eq("credential_configured", true)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (testSenderError || !testSender) return reply({ error: "Save your own sender settings first." }, 400);
      const { data: testSecretText, error: testSecretError } = await serviceClient.rpc("service_get_sender_secret", { p_profile_id: testSender.id });
      if (testSecretError || !testSecretText) return reply({ error: "Saved credentials could not be loaded securely." }, 500);
      let testSecret: any;
      try { testSecret = JSON.parse(testSecretText); } catch { return reply({ error: "Saved credential format is invalid." }, 500); }
      if (testSecret.provider === "resend") {
        const check = await fetch("https://api.resend.com/domains", { headers: { Authorization: "Bearer " + testSecret.api_key } });
        if (!check.ok) return reply({ error: "Resend rejected this API key (HTTP " + check.status + ")." }, 400);
        return reply({ ok: true, message: "Resend API key authenticated successfully. No email was sent." });
      }
      if (testSecret.provider !== "smtp") return reply({ error: "Unsupported sender provider." }, 400);
      try {
        const transport = nodemailer.createTransport({
          host: testSender.host, port: Number(testSender.port),
          secure: testSender.secure_mode === "ssl" || Number(testSender.port) === 465,
          requireTLS: (testSender.secure_mode === "starttls" || testSender.secure_mode === "tls") && Number(testSender.port) !== 465,
          auth: { user: testSender.username, pass: testSecret.password },
          connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
        });
        await transport.verify();
        transport.close();
        return reply({ ok: true, message: "SMTP connection and authentication succeeded. No email was sent." });
      } catch (e) {
        return reply({ error: "SMTP test failed: " + String(e instanceof Error ? e.message : e).slice(0, 300) }, 400);
      }
    }
    const campaignId = String(body.campaign_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return reply({ error: "Valid campaign_id required" }, 400);

    const { data: campaign, error: campaignError } = await userClient
      .from("campaigns").select("id,user_id,name,subject,html_body,status")
      .eq("id", campaignId).eq("user_id", user.id).maybeSingle();
    if (campaignError || !campaign) return reply({ error: "Campaign not found for this account" }, 404);
    if (["canceled", "failed"].includes(campaign.status)) return reply({ error: "This campaign cannot be sent in its current status" }, 409);

    const { data: sub, error: subError } = await userClient.from("subscriptions")
      .select("status,starts_at,ends_at,max_monthly_emails")
      .eq("user_id", user.id).maybeSingle();
    const now = Date.now();
    if (subError || !sub || !["active", "trial"].includes(sub.status) ||
        (sub.starts_at && new Date(sub.starts_at).getTime() > now) ||
        (sub.ends_at && new Date(sub.ends_at).getTime() < now)) {
      return reply({ error: "An active subscription or trial is required before sending." }, 403);
    }
    const allowance = Number(sub.max_monthly_emails ?? 0);
    if (!Number.isFinite(allowance) || allowance < 1) return reply({ error: "Your account has no monthly email allowance. Contact the administrator." }, 403);

    const { data: gmailProfile, error: gmailProfileError } = await userClient.from("gmail_sender_profiles")
      .select("user_id,gmail_email,credential_configured").eq("user_id", user.id).eq("credential_configured", true).maybeSingle();
    if (gmailProfileError) return reply({ error: "Could not read Gmail API connection." }, 500);
    let sender: any;
    const gmailMode = !!gmailProfile;
    if (gmailMode) {
      sender = { id: null, label: "Gmail API", from_email: gmailProfile.gmail_email, hourly_limit: 100, batch_size: 20 };
    } else {
      const { data: smtpSender, error: senderError } = await userClient.from("smtp_profiles")
        .select("id,label,host,port,username,secure_mode,batch_size,hourly_limit,credential_configured,enabled,from_email")
        .eq("user_id", user.id).eq("enabled", true).eq("credential_configured", true)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (senderError || !smtpSender) return reply({ error: "Connect Gmail API or configure your own SMTP/Resend sender in Account & SMTP before sending." }, 400);
      sender = smtpSender;
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const hourStart = new Date(now - 60 * 60 * 1000).toISOString();
    const [{ count: sentThisMonth, error: quotaError }, { count: sentLastHour, error: hourlyError }] = await Promise.all([
      userClient.from("email_events").select("id", { count: "exact", head: true }).eq("user_id", user.id)
        .eq("event_type", "sent").gte("created_at", monthStart.toISOString()),
      userClient.from("email_events").select("id", { count: "exact", head: true }).eq("user_id", user.id)
        .eq("event_type", "sent").gte("created_at", hourStart)
    ]);
    if (quotaError || hourlyError) return reply({ error: "Could not verify sending limits." }, 500);
    const remainingAllowance = Math.max(0, allowance - (sentThisMonth ?? 0));
    const remainingHourly = Math.max(0, Number(sender.hourly_limit ?? 100) - (sentLastHour ?? 0));
    if (remainingAllowance < 1) return reply({ error: "Monthly email allowance reached." }, 429);
    if (remainingHourly < 1) return reply({ error: "Hourly sending limit reached. Wait until the quota window refreshes." }, 429);

    const { count: existingCount, error: countError } = await userClient.from("campaign_recipients")
      .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
    if (countError) return reply({ error: "Could not read campaign recipients." }, 500);

    if ((existingCount ?? 0) === 0) {
      const [{ data: contacts, error: contactsError }, { data: suppressed, error: suppressionError }] = await Promise.all([
        userClient.from("contacts").select("email,full_name,custom_fields,suppressed")
          .eq("user_id", user.id).eq("suppressed", false).limit(1000),
        userClient.from("suppression_list").select("email").eq("user_id", user.id).limit(5000)
      ]);
      if (contactsError || suppressionError) return reply({ error: "Could not prepare campaign recipients." }, 500);
      const suppressionSet = new Set((suppressed ?? []).map((x: any) => String(x.email).toLowerCase()));
      const rows = (contacts ?? []).filter((c: any) => !suppressionSet.has(String(c.email).toLowerCase()))
        .map((c: any) => ({
          campaign_id: campaignId,
          email: String(c.email).trim().toLowerCase(),
          display_name: c.full_name ?? "",
          merge_data: { ...(c.custom_fields ?? {}), full_name: c.full_name ?? "", email: c.email }
        }));
      if (!rows.length) return reply({ error: "No eligible recipients. Add contacts who have consented to receive these emails." }, 400);
      const { error: insertError } = await userClient.from("campaign_recipients")
        .upsert(rows, { onConflict: "campaign_id,email", ignoreDuplicates: true });
      if (insertError) return reply({ error: "Could not queue recipients: " + insertError.message }, 500);
      await userClient.from("email_events").insert({
        user_id: user.id, campaign_id: campaignId, event_type: "queued",
        detail: { recipients: rows.length, provider: sender.label }
      });
    }

    const batchLimit = Math.max(1, Math.min(20, Number(sender.batch_size ?? 20), remainingAllowance, remainingHourly));
    const { data: candidates, error: candidatesError } = await userClient.from("campaign_recipients")
      .select("id,email,display_name,merge_data").eq("campaign_id", campaignId)
      .eq("status", "pending").limit(batchLimit);
    if (candidatesError) return reply({ error: "Could not load pending recipients." }, 500);
    if (!candidates?.length) {
      const { count: pending } = await userClient.from("campaign_recipients")
        .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).in("status", ["pending", "sending"]);
      return reply({ ok: true, sent: 0, failed: 0, remaining: pending ?? 0, message: "No pending recipients in this batch." });
    }

    const ids = candidates.map((r: any) => r.id);
    const { data: claimed, error: claimError } = await userClient.from("campaign_recipients")
      .update({ status: "sending", smtp_profile_id: sender.id })
      .in("id", ids).eq("campaign_id", campaignId).eq("status", "pending")
      .select("id,email,display_name,merge_data");
    if (claimError) return reply({ error: "Could not claim the next sending batch." }, 500);
    if (!claimed?.length) return reply({ ok: true, sent: 0, failed: 0, remaining: ids.length, message: "Another batch is already processing." });

    const secretResult = gmailMode
      ? await serviceClient.rpc("service_get_gmail_secret", { p_user_id: user.id })
      : await serviceClient.rpc("service_get_sender_secret", { p_profile_id: sender.id });
    const secretText = secretResult.data, secretError = secretResult.error;
    if (secretError || !secretText) {
      await userClient.from("campaign_recipients").update({ status: "pending", smtp_profile_id: null }).in("id", claimed.map((x: any) => x.id));
      return reply({ error: "Secure sender credentials could not be loaded." }, 500);
    }
    let secret: any;
    try { secret = JSON.parse(secretText); } catch {
      await userClient.from("campaign_recipients").update({ status: "pending", smtp_profile_id: null }).in("id", claimed.map((x: any) => x.id));
      return reply({ error: "Sender credential format is invalid." }, 500);
    }
    if (gmailMode) {
      if (!secret.refresh_token) {
        await userClient.from("campaign_recipients").update({ status: "pending", smtp_profile_id: null }).in("id", claimed.map((x: any) => x.id));
        return reply({ error: "Gmail refresh token is missing. Disconnect and reconnect Gmail." }, 401);
      }
      if (Number(secret.expires_at || 0) < Date.now() + 60000) {
        const clientId = Deno.env.get("GOOGLE_CLIENT_ID"), clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
        if (!clientId || !clientSecret) {
          await userClient.from("campaign_recipients").update({ status: "pending", smtp_profile_id: null }).in("id", claimed.map((x: any) => x.id));
          return reply({ error: "Google OAuth is not configured in Supabase Edge Function secrets." }, 503);
        }
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: secret.refresh_token, grant_type: "refresh_token" }) });
        const refreshed = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !refreshed.access_token) {
          await userClient.from("campaign_recipients").update({ status: "pending", smtp_profile_id: null }).in("id", claimed.map((x: any) => x.id));
          return reply({ error: "Gmail access token refresh failed. Reconnect Gmail." }, 401);
        }
        secret = { ...secret, access_token: refreshed.access_token, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 };
        const saved = await serviceClient.rpc("service_store_gmail_credentials", { p_user_id: user.id, p_gmail_email: gmailProfile.gmail_email, p_payload: JSON.stringify(secret) });
        if (saved.error) {
          await userClient.from("campaign_recipients").update({ status: "pending", smtp_profile_id: null }).in("id", claimed.map((x: any) => x.id));
          return reply({ error: "Could not securely refresh Gmail credentials." }, 500);
        }
      }
    }

    let sent = 0, failed = 0;
    for (const recipient of claimed as any[]) {
      const mergeData = { ...(recipient.merge_data ?? {}), full_name: recipient.display_name ?? "", email: recipient.email };
      const subject = personalize(String(campaign.subject ?? ""), mergeData);
      const html = personalize(String(campaign.html_body ?? ""), mergeData);
      try {
        let providerId: string | null = null;
        if (secret.provider === "gmail" && gmailMode) {
          const encodedSubject = "=?UTF-8?B?" + btoa(unescape(encodeURIComponent(subject))) + "?=";
          const htmlBytes = new TextEncoder().encode(html);
          let htmlBinary = "";
          for (let i = 0; i < htmlBytes.length; i += 8192) htmlBinary += String.fromCharCode(...htmlBytes.subarray(i, i + 8192));
          const htmlBase64 = btoa(htmlBinary);
          const mime = "To: " + recipient.email + "\r\nFrom: " + secret.from_email + "\r\nSubject: " + encodedSubject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + htmlBase64;
          const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST", headers: { Authorization: "Bearer " + secret.access_token, "Content-Type": "application/json" },
            body: JSON.stringify({ raw: base64UrlUtf8(mime) })
          });
          const responseBody = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String(responseBody?.error?.message ?? "Gmail API rejected the email").slice(0, 400));
          providerId = responseBody.id ?? null;
        } else if (secret.provider === "resend") {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": "Bearer " + secret.api_key, "Content-Type": "application/json" },
            body: JSON.stringify({ from: secret.from_email, to: [recipient.email], subject, html })
          });
          const responseBody = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String(responseBody?.message ?? responseBody?.error ?? "Provider rejected the email").slice(0, 400));
          providerId = responseBody.id ?? null;
        } else if (secret.provider === "smtp") {
          const transport = nodemailer.createTransport({
            host: sender.host, port: Number(sender.port),
            secure: sender.secure_mode === "ssl" || Number(sender.port) === 465,
            requireTLS: (sender.secure_mode === "starttls" || sender.secure_mode === "tls") && Number(sender.port) !== 465,
            auth: { user: sender.username, pass: secret.password },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
          });
          try {
            const info = await transport.sendMail({ from: secret.from_email, to: recipient.email, subject, html });
            providerId = String(info.messageId ?? "");
          } finally { transport.close(); }
        } else {
          throw new Error("Unsupported sender provider.");
        }
        sent++;
        await userClient.from("campaign_recipients").update({
          status: "sent", provider_message_id: providerId, error_message: null, sent_at: new Date().toISOString()
        }).eq("id", recipient.id).eq("campaign_id", campaignId);
        await userClient.from("email_events").insert({
          user_id: user.id, campaign_id: campaignId, recipient_id: recipient.id,
          event_type: "sent", detail: { provider: secret.provider, provider_message_id: providerId }
        });
      } catch (e) {
        const errorMessage = String(e instanceof Error ? e.message : e).slice(0, 400);
        failed++;
        await userClient.from("campaign_recipients").update({ status: "failed", error_message: errorMessage })
          .eq("id", recipient.id).eq("campaign_id", campaignId);
        await userClient.from("email_events").insert({
          user_id: user.id, campaign_id: campaignId, recipient_id: recipient.id,
          event_type: "failed", detail: { provider: secret.provider, error: errorMessage }
        });
      }
    }

    const [{ count: pending }, { count: sending }, { count: totalSent }, { count: totalFailed }] = await Promise.all([
      userClient.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending"),
      userClient.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "sending"),
      userClient.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "sent"),
      userClient.from("campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "failed")
    ]);
    const remaining = (pending ?? 0) + (sending ?? 0);
    await userClient.from("campaigns").update({
      status: remaining > 0 ? "sending" : ((totalSent ?? 0) > 0 ? "completed" : "failed"),
      total_recipients: (totalSent ?? 0) + (totalFailed ?? 0) + remaining,
      sent_count: totalSent ?? 0, failed_count: totalFailed ?? 0,
      completed_at: remaining === 0 ? new Date().toISOString() : null
    }).eq("id", campaignId).eq("user_id", user.id);

    return reply({ ok: true, sent, failed, remaining, message: remaining > 0 ? "Batch complete. More recipients remain." : "Campaign processing complete." });
  } catch (error) {
    return reply({ error: String(error instanceof Error ? error.message : error).slice(0, 500) }, 500);
  }
});
