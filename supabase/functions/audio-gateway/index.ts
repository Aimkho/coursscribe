// Passerelle de stockage audio CoursScribe.
// Le serveur de l'application (Vercel) n'a pas besoin de la clé service_role :
// il s'authentifie avec un secret partagé lu dans public.app_secrets,
// et cette fonction (qui dispose de la clé service_role côté Supabase)
// génère les URL signées du bucket privé "audio".
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
let secret: string | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validPath = (p: unknown): p is string =>
  typeof p === "string" && /^[0-9]+\/[A-Za-z0-9_-]+$/.test(p);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!secret) {
    const { data } = await sb.from("app_secrets").select("value").eq("name", "storage_gateway").single();
    secret = data?.value ?? null;
  }
  const given = req.headers.get("x-app-secret") || "";
  if (!secret || given.length !== secret.length || given !== secret) return json({ error: "forbidden" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "body" }, 400); }
  const bucket = sb.storage.from("audio");

  if (body.op === "upload") {
    if (!validPath(body.path)) return json({ error: "path" }, 400);
    const { data, error } = await bucket.createSignedUploadUrl(body.path, { upsert: true });
    if (error) return json({ error: error.message }, 500);
    return json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
  }
  if (body.op === "download") {
    if (!validPath(body.path)) return json({ error: "path" }, 400);
    const { data, error } = await bucket.createSignedUrl(body.path, Math.min(Number(body.expiresIn) || 3600, 86400));
    if (error) return json({ error: error.message }, 404);
    return json({ signedUrl: data.signedUrl });
  }
  if (body.op === "remove") {
    const paths = Array.isArray(body.paths) ? body.paths.filter(validPath) : [];
    if (body.prefix && /^[0-9]+$/.test(String(body.prefix))) {
      const { data } = await bucket.list(String(body.prefix), { limit: 1000 });
      for (const f of data || []) paths.push(`${body.prefix}/${f.name}`);
    }
    if (!paths.length) return json({ removed: 0 });
    const { error } = await bucket.remove(paths);
    if (error) return json({ error: error.message }, 500);
    return json({ removed: paths.length });
  }
  return json({ error: "op" }, 400);
});
