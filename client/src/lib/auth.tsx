import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@shared/schema";
import { apiRequest, queryClient, setAuthToken, setUnauthorizedHandler } from "./queryClient";

type AuthCtx = {
  user: PublicUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);

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
