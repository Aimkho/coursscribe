import "dotenv/config";
import { createApp, log } from "./app";
import { serveStatic } from "./static";

export { log };

(async () => {
  const { app, httpServer } = await createApp();

  // Vite en développement (après les routes pour que le « catch-all » n'intercepte pas l'API).
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => log(`serving on port ${port}`));
})();
