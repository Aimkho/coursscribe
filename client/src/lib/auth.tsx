import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@shared/schema";
import { apiRequest, queryClient, setAuthToken, setUnauthorizedHandler } from "./queryClient";

type AuthCtx = {
  user: PublicUser | null;
  /** Faux tant qu'un transfert de session (ouverture dans un nouvel onglet) est en cours. */
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(() => !/[?&]handoff=/.test(window.location.hash));

  // Ouverture dans un nouvel onglet : un code à usage unique (2 min) remplace la reconnexion.
  useEffect(() => {
    const m = window.location.hash.match(/[?&]handoff=([a-f0-9]+)/);
    if (!m) return;
    const clean = window.location.hash.replace(/[?&]handoff=[a-f0-9]+/, "");
    try {
      history.replaceState(null, "", clean || "#/");
    } catch {
      window.location.hash = clean || "#/";
    }
    apiRequest("POST", "/api/auth/handoff/redeem", { code: m[1] })
      .then(finish)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setUser(null);
      queryClient.clear();
    });
  }, []);

  async function finish(res: Response) {
    const data = await res.json();
    setAuthToken(data.token);
    queryClient.clear();
    setUser(data.user);
  }

  const value: AuthCtx = {
    user,
    ready,
    login: async (email, password) => finish(await apiRequest("POST", "/api/auth/login", { email, password })),
    register: async (name, email, password) =>
      finish(await apiRequest("POST", "/api/auth/register", { name, email, password })),
    logout: async () => {
      try {
        await apiRequest("POST", "/api/auth/logout");
      } catch {
        /* déjà déconnecté */
      }
      setAuthToken(null);
      setUser(null);
      queryClient.clear();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth hors AuthProvider");
  return c;
}
