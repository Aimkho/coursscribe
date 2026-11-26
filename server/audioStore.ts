/**
 * Stockage de l'audio des séances dans Supabase Storage (bucket privé "audio").
 * Les URL signées sont produites par la fonction Edge "audio-gateway" ;
 * le serveur s'y authentifie avec un secret partagé lu dans public.app_secrets.
 * Le navigateur envoie et lit les fichiers directement chez Supabase :
 * aucun fichier audio ne transite par le serveur (limite de 4,5 Mo sur Vercel).
 */
import { one } from "./db";

let secret: string | null = null;

function supabaseUrl() {
  const url = process.env.SUPABASE_URL || (process.env.SUPABASE_REF ? `https://${process.env.SUPABASE_REF}.supabase.co` : "");
  if (!url) throw new Error("SUPABASE_URL manquante.");
  return url.replace(/\/+$/, "");
}

async function gateway(body: Record<string, unknown>) {
  if (!secret) {
    const r = await one<{ value: string }>(`select value from public.app_secrets where name = 'storage_gateway'`);
    secret = r?.value ?? null;
    if (!secret) throw new Error("Secret de stockage absent.");
  }
  const res = await fetch(`${supabaseUrl()}/functions/v1/audio-gateway`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-secret": secret },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || `Stockage : erreur ${res.status}`), { status: res.status });
  return data;
}

export const audioKey = (courseId: number, sessionId?: number) => `${courseId}/${sessionId ? `s${sessionId}` : "legacy"}`;

export async function signedUploadUrl(key: string): Promise<string> {
  return (await gateway({ op: "upload", path: key })).signedUrl;
}

export async function signedDownloadUrl(key: string, expiresIn = 3600): Promise<string | null> {
  try {
    return (await gateway({ op: "download", path: key, expiresIn })).signedUrl;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function removeCourseAudio(courseId: number) {
  try {
    await gateway({ op: "remove", prefix: String(courseId) });
  } catch (e: any) {
    console.error("audio remove", courseId, e?.message);
  }
}

/** Lecture d'un fichier stocké (énoncé photographié) pour l'envoyer à l'IA. */
export async function fetchStored(key: string, maxBytes: number): Promise<Buffer | null> {
  const url = await signedDownloadUrl(key, 600);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > maxBytes ? null : buf;
}

export async function removeKeys(paths: string[]) {
  try {
    await gateway({ op: "remove", paths });
  } catch (e: any) {
    console.error("storage remove", paths.join(","), e?.message);
  }
}
