// Point d'entrée de la fonction Vercel : toutes les requêtes /api/* arrivent ici.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app";

const ready = createApp().then(({ app }) => app);

/** Rétablit le chemin d'origine si Vercel a réécrit l'URL en /api?__p=… */
function restoreUrl(req: IncomingMessage) {
  const u = new URL(req.url || "/", "http://x");
  const p = u.searchParams.get("__p");
  if (p === null) return;
  u.searchParams.delete("__p");
  if (u.pathname === "/api" || u.pathname === "/api/") {
    const qs = u.searchParams.toString();
    req.url = `/api/${p.replace(/^\/+/, "")}${qs ? `?${qs}` : ""}`;
  } else {
    const qs = u.searchParams.toString();
    req.url = `${u.pathname}${qs ? `?${qs}` : ""}`;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  restoreUrl(req);
  const app = await ready;
  return (app as any)(req, res);
}
