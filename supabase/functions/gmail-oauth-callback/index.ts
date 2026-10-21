import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const appUrl="https://supporttools01.github.io/Nxmailer/";
const redirect=(status:string)=>Response.redirect(appUrl+"?gmail="+encodeURIComponent(status),302);
const b64url=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const fromB64url=(value:string)=>{const base=value.replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base+"=".repeat((4-base.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0))};
const hmac=async(value:string,secret:string)=>{const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value))))};
const equal=(a:string,b:string)=>a.length===b.length&&[...a].reduce((v,c,i)=>v|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
Deno.serve(async(req:Request)=>{
 const incoming=new URL(req.url);if(incoming.searchParams.get("error"))return redirect("error_google_consent_denied");
 const code=incoming.searchParams.get("code"),state=incoming.searchParams.get("state")||"";
 const clientId=Deno.env.get("GOOGLE_CLIENT_ID"),clientSecret=Deno.env.get("GOOGLE_CLIENT_SECRET"),url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!code||!clientId||!clientSecret||!url||!serviceKey)return redirect("error_oauth_configuration");
 try{
  const parts=state.split(".");const encoded=parts[0],signature=parts[1];if(!encoded||!signature||parts.length!==2)return redirect("error_invalid_state");
  if(!equal(signature,await hmac(encoded,clientSecret)))return redirect("error_invalid_state");
  const payload=JSON.parse(new TextDecoder().decode(fromB64url(encoded)));
  if(!payload.uid||!payload.ts||Math.abs(Date.now()-Number(payload.ts))>10*60*1000)return redirect("error_expired_state");
  const redirectUri="https://qismpexnxgwisyjjepyt.supabase.co/functions/v1/gmail-oauth-callback";
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:"authorization_code"})});
  const tokens=await tokenResponse.json().catch(()=>({}));if(!tokenResponse.ok||!tokens.access_token)return redirect("error_token_exchange");
  const infoResponse=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:"Bearer "+tokens.access_token}});
  const info=await infoResponse.json().catch(()=>({}));if(!infoResponse.ok||!info.email||info.email_verified!==true)return redirect("error_google_profile");
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  let old:any=null;if(!tokens.refresh_token){const {data:oldText}=await service.rpc("service_get_gmail_secret",{p_user_id:payload.uid});if(oldText){try{old=JSON.parse(oldText)}catch{old=null}}}
  const refreshToken=tokens.refresh_token||old?.refresh_token;if(!refreshToken)return redirect("error_missing_refresh_token");
  const secret={provider:"gmail",from_email:String(info.email).toLowerCase(),access_token:tokens.access_token,refresh_token:refreshToken,expires_at:Date.now()+Number(tokens.expires_in||3600)*1000,token_type:tokens.token_type||"Bearer",scope:tokens.scope||""};
  const {error}=await service.rpc("service_store_gmail_credentials",{p_user_id:payload.uid,p_gmail_email:String(info.email).toLowerCase(),p_payload:JSON.stringify(secret)});
  if(error)return redirect("error_secure_storage");return redirect("connected");
 }catch{return redirect("error_oauth_callback")}
});