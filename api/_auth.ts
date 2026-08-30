import type { VercelRequest } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!url) {
    throw new Error("Supabase server configuration is missing: SUPABASE_URL");
  }
  if (!key) {
    throw new Error("Supabase server configuration is missing: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

function parseCookies(req: VercelRequest) {
  const header = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]),
  );
}

export async function getAuthenticatedUser(req: VercelRequest) {
  const sessionId = parseCookies(req).agentmarket_session;
  if (!sessionId) return null;

  const supabase = serverClient();
  const { data: session, error } = await supabase
    .from("user_sessions")
    .select("id,user_id,wallet_address,expires_at,verified_at,revoked_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !session || session.revoked_at || !session.verified_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  const { data: user } = await supabase
    .from("users")
    .select("id,wallet_address,display_name,avatar_url,created_at,updated_at")
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user) return null;
  return { user, session };
}

export { serverClient };
