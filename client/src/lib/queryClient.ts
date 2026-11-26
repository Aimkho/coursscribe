import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Jeton de session : en mémoire ; sur Vercel (VITE_PERSIST_TOKEN=1 au build), aussi dans le navigateur
// pour que la session survive au rechargement. L'aperçu intégré n'autorise pas ce stockage.
const TOKEN_KEY = "cs_token";
const PERSIST = import.meta.env.VITE_PERSIST_TOKEN === "1";
function readStoredToken(): string | null {
  if (!PERSIST) return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
let authToken: string | null = readStoredToken();
let onUnauthorized: (() => void) | null = null;
let onConsentRequired: (() => void) | null = null;
export function setAuthToken(t: string | null) {
  authToken = t;
  if (!PERSIST) return;
  try {
    if (t) window.localStorage.setItem(TOKEN_KEY, t);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible */
  }
}
export function setConsentRequiredHandler(fn: () => void) {
  onConsentRequired = fn;
}
export function getAuthToken() {
  return authToken;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && authToken) onUnauthorized();
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message || message;
      if (res.status === 403 && body.code === "consent_required" && onConsentRequired) onConsentRequired();
    } catch {
      /* corps non JSON */
    }
    throw new Error(message || `Erreur ${res.status}`);
  }
}

function headers(extra?: Record<string, string>) {
  const h: Record<string, string> = { ...(extra || {}) };
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: headers(data ? { "Content-Type": "application/json" } : undefined),
    body: data ? JSON.stringify(data) : undefined,
  });
  await throwIfResNotOk(res);
  return res;
}

export async function apiUpload(url: string, blob: Blob): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: headers({ "Content-Type": blob.type || "application/octet-stream" }),
    body: blob,
  });
  await throwIfResNotOk(res);
  return res;
}

/** Télécharge un fichier généré par le serveur (export PDF, Word, PowerPoint). */
export async function apiDownload(url: string, fallbackName: string) {
  const res = await fetch(`${API_BASE}${url}`, { headers: headers() });
  await throwIfResNotOk(res);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
}

/** Envoie un extrait audio du micro et renvoie le texte transcrit par l'IA. */
export async function apiTranscribe(blob: Blob, context: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/transcribe?context=${encodeURIComponent(context.slice(0, 300))}`, {
    method: "POST",
    headers: headers({ "Content-Type": blob.type || "audio/webm" }),
    body: blob,
  });
  await throwIfResNotOk(res);
  const data = await res.json();
  return String(data.text || "");
}

export function audioUrl(courseId: number, download = false, sessionId?: number) {
  const base = sessionId ? `/api/courses/${courseId}/sessions/${sessionId}/audio` : `/api/courses/${courseId}/audio`;
  return `${API_BASE}${base}?token=${authToken ?? ""}${download ? "&download=1" : ""}`;
}

/**
 * Sauvegarde l'audio d'une séance : le navigateur envoie le fichier directement
 * dans le stockage Supabase (URL signée), sans passer par le serveur.
 */
export async function apiUploadSessionAudio(courseId: number, sessionId: number, blob: Blob) {
  const r = await apiRequest("POST", `/api/courses/${courseId}/sessions/${sessionId}/audio-upload`);
  const { url } = await r.json();
  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": (blob.type || "audio/webm").split(";")[0], "x-upsert": "true" },
    body: blob,
  });
  if (!put.ok) throw new Error(`Envoi de l'audio impossible (${put.status}).`);
  await apiRequest("POST", `/api/courses/${courseId}/sessions/${sessionId}/audio-done`);
}

/** Durée d'un fichier audio lue par le navigateur (0 si inconnue). */
function readDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("audio");
    let done = false;
    const end = (d: number) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) return end(a.duration);
      // WebM sans durée : on force la lecture jusqu'à la fin pour l'obtenir.
      a.currentTime = 1e7;
      a.ontimeupdate = () => end(a.duration);
    };
    a.onerror = () => end(0);
    setTimeout(() => end(a.duration), 15000);
    a.src = url;
  });
}

const WINDOW_SEC = 60 * 60; // Google facture le fichier entier à chaque requête : une seule requête par heure d'audio

/**
 * Transcrit un fichier audio complet (enregistrement du téléphone, dictaphone…) :
 * envoi par morceaux de 4 Mo vers l'IA, puis transcription fenêtre par fenêtre.
 */
export async function apiTranscribeFile(
  file: Blob & { name?: string },
  context: string,
  onProgress: (p: { done: number; total: number; text: string }) => void,
  signal?: { cancelled: boolean },
): Promise<{ text: string; durationSec: number }> {
  const check = () => {
    if (signal?.cancelled) throw new Error("Import annulé.");
  };
  const durationSec = await readDuration(file);
  // Estimation si le navigateur ne lit pas la durée (~1 Mo par minute en mp3 128 kbit/s)
  const dur = durationSec || Math.max(60, (file.size / (1024 * 1024)) * 60);
  const windows: [number, number][] = [];
  for (let t = 0; t < dur; t += WINDOW_SEC) windows.push([t, Math.min(dur, t + WINDOW_SEC)]);
  const uploadSteps = Math.ceil(file.size / (4 * 1024 * 1024));
  const total = uploadSteps + windows.length;
  let done = 0;
  onProgress({ done, total, text: "" });

  const mime = (file.type || "audio/mpeg").split(";")[0];
  const start = await apiRequest("POST", "/api/import/start", { size: file.size, mime, name: file.name || "cours" });
  const { id, chunkSize } = (await start.json()) as { id: number; chunkSize: number };
  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      check();
      const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const res = await fetch(`${API_BASE}/api/import/${id}/chunk?offset=${offset}`, {
          method: "PUT",
          headers: headers({ "Content-Type": "application/octet-stream" }),
          body: chunk,
        });
        if (res.ok) ok = true;
        else if (attempt === 2) await throwIfResNotOk(res);
      }
      onProgress({ done: ++done, total, text: "" });
    }
    // Le fichier est analysé par l'IA (quelques secondes)
    for (let i = 0; i < 60; i++) {
      check();
      const st = await (await apiRequest("GET", `/api/import/${id}/status`)).json();
      if (st.state === "ACTIVE") break;
      if (st.state === "FAILED") throw new Error("Format audio non reconnu.");
      await new Promise((r) => setTimeout(r, 2000));
    }
    const out: string[] = new Array(windows.length).fill("");
    let next = 0;
    let failed = 0;
    const worker = async () => {
      while (next < windows.length) {
        check();
        const i = next++;
        const [s, e] = windows[i];
        let text = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await apiRequest("POST", `/api/import/${id}/part`, { start: s, end: e, duration: dur, context });
            text = String((await r.json()).text || "");
            break;
          } catch (err) {
            if (attempt === 1) failed++;
            else await new Promise((r) => setTimeout(r, 3000));
          }
        }
        out[i] = text;
        onProgress({ done: ++done, total, text: out.filter(Boolean).join(" ") });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, windows.length) }, worker));
    check();
    const text = out.filter(Boolean).join("\n\n");
    if (failed && !text) throw new Error("La transcription du fichier a échoué. Réessaie.");
    return { text, durationSec: Math.round(durationSec) };
  } finally {
    fetch(`${API_BASE}/api/import/${id}`, { method: "DELETE", headers: headers() }).catch(() => {});
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers: headers() });
    if (unauthorizedBehavior === "returnNull" && res.status === 401) return null;
    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: { retry: false },
  },
});

// ---------- Énoncés d'exercices (photos, PDF) ----------
export function attachmentUrl(courseId: number, attId: number) {
  return `${API_BASE}/api/courses/${courseId}/attachments/${attId}/file?token=${authToken ?? ""}`;
}

/** Réduit une photo à 2000 px de côté en JPEG : lisible par l'IA, rapide à envoyer en 4G. */
async function compressImage(file: File): Promise<Blob> {
  if (file.type === "application/pdf") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size * 1.2 ? blob : file;
  } catch {
    return file;
  }
}

/** Envoie un énoncé dans le stockage puis demande à l'IA de le lire. */
export async function apiUploadAttachment(
  courseId: number,
  file: File,
  opts: { exerciseNo?: number | null; sessionId?: number | null; label?: string } = {},
) {
  const blob = await compressImage(file);
  let mime = (blob.type || file.type || "").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) mime = "image/jpeg";
  const r = await apiRequest("POST", `/api/courses/${courseId}/attachments`, {
    mime,
    size: blob.size,
    exerciseNo: opts.exerciseNo ?? null,
    sessionId: opts.sessionId ?? null,
    label: opts.label ?? "",
  });
  const { id, url } = await r.json();
  const put = await fetch(url, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "true" }, body: blob });
  if (!put.ok) throw new Error(`Envoi de la photo impossible (${put.status}).`);
  const done = await apiRequest("POST", `/api/courses/${courseId}/attachments/${id}/done`);
  return (await done.json()) as import("@shared/schema").Attachment & { readError?: boolean };
}
