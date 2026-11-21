import express, { type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "node:http";
import { registerRoutes } from "./routes";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const t = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`${t} [${source}] ${message}`);
}

/** Construit l'application Express (API). Utilisée par le serveur local et par la fonction Vercel. */
export async function createApp(): Promise<{ app: express.Express; httpServer: Server }> {
  const app = express();
  const httpServer = createServer(app);
  app.set("trust proxy", true);

  app.use(
    express.json({
      limit: "4mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api")) log(`${req.method} ${req.path} ${res.statusCode} in ${Date.now() - start}ms`);
    });
    next();
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    console.error("Internal Server Error:", err?.message);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message: status === 413 ? "Fichier trop volumineux." : "Erreur serveur." });
  });

  return { app, httpServer };
}
