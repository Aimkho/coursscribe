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

export function audioUrl(courseId: number, download = false) {
  return `${API_BASE}/api/courses/${courseId}/audio?token=${authToken ?? ""}${download ? "&download=1" : ""}`;
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
