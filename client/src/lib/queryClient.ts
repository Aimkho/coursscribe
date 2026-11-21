import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// Le jeton de session est conservé en mémoire (le stockage navigateur est bloqué dans l'aperçu).
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export function setAuthToken(t: string | null) {
  authToken = t;
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

/** Transcrit un fichier audio complet (enregistrement du téléphone, dictaphone…). */
export async function apiTranscribeFile(
  file: Blob,
  context: string,
  onProgress: (p: { done: number; total: number; text: string }) => void,
  signal?: { cancelled: boolean },
): Promise<{ text: string; durationSec: number }> {
  const res = await fetch(`${API_BASE}/api/transcribe-file?context=${encodeURIComponent(context.slice(0, 300))}`, {
    method: "POST",
    headers: headers({ "Content-Type": file.type || "application/octet-stream" }),
    body: file,
  });
  await throwIfResNotOk(res);
  const { jobId } = await res.json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.cancelled) throw new Error("Import annulé.");
    const r = await fetch(`${API_BASE}/api/transcribe-file/${jobId}`, { headers: headers() });
    await throwIfResNotOk(r);
    const j = await r.json();
    onProgress({ done: j.done, total: j.total, text: j.text });
    if (j.status === "done") return { text: j.text, durationSec: j.durationSec };
    if (j.status === "error") throw new Error(j.error || "La transcription du fichier a échoué.");
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
