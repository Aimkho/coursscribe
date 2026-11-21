/**
 * Construction pour Vercel (Build Output API v3) :
 *   .vercel/output/static            -> application React (dist/public)
 *   .vercel/output/functions/api.func -> API Express regroupée en un seul fichier
 *   .vercel/output/config.json       -> /api/* vers la fonction, le reste vers les fichiers statiques
 * Lancement : npm run build:vercel (Vercel l'exécute automatiquement grâce à vercel.json).
 */
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { cp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const OUT = ".vercel/output";
const FUNC = `${OUT}/functions/api.func`;

async function main() {
  await rm(OUT, { recursive: true, force: true });

  console.log("client…");
  await viteBuild();
  await mkdir(`${OUT}/static`, { recursive: true });
  await cp("dist/public", `${OUT}/static`, { recursive: true });

  console.log("fonction API…");
  await mkdir(FUNC, { recursive: true });
  await esbuild({
    entryPoints: ["server/vercel.ts"],
    platform: "node",
    target: "node22",
    bundle: true,
    format: "cjs",
    outfile: `${FUNC}/index.js`,
    // Certaines dépendances (unicode-properties, via pdfkit) lisent leurs fichiers avec import.meta.url :
    // en CommonJS, on le remplace par l'URL du fichier de la fonction.
    banner: { js: 'const __meta_url = require("url").pathToFileURL(__filename).href;' },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.url": "__meta_url" },
    alias: { "@shared": path.resolve("shared") },
    // Modules facultatifs jamais utilisés en production
    external: ["pg-native", "vite", "./vite", "lightningcss", "@babel/*", "fsevents", "bufferutil", "utf-8-validate"],
    minify: true,
    legalComments: "none",
    logLevel: "info",
  });

  // Fichiers lus à l'exécution : polices Lato (PDF) et métriques des polices standard de pdfkit.
  await cp("server/fonts", `${FUNC}/fonts`, { recursive: true });
  await cp("node_modules/pdfkit/js/data", `${FUNC}/data`, { recursive: true });
  await cp("node_modules/unicode-properties/data.trie", `${FUNC}/data.trie`);
  for (const f of await readdir("node_modules/pdfkit/js")) {
    if (f.endsWith(".icc")) await cp(`node_modules/pdfkit/js/${f}`, `${FUNC}/${f}`);
  }

  await writeFile(
    `${FUNC}/.vc-config.json`,
    JSON.stringify({ runtime: "nodejs22.x", handler: "index.js", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 300, supportsResponseStreaming: false }, null, 2),
  );
  await writeFile(`${FUNC}/package.json`, JSON.stringify({ type: "commonjs" }));

  await writeFile(
    `${OUT}/config.json`,
    JSON.stringify(
      {
        version: 3,
        routes: [
          { src: "^/api/(.*)$", dest: "/api?__p=$1" },
          { src: "^/assets/(.*)$", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
          { handle: "filesystem" },
          { src: "/(.*)", dest: "/index.html" },
        ],
      },
      null,
      2,
    ),
  );
  console.log("ok -> .vercel/output");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
