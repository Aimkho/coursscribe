import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// Charge la configuration Supabase (fichier .env.db non versionné).
function loadEnvFile(file: string) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvFile(".env.db");

// bigint -> number (identifiants et horodatages en ms restent < 2^53)
pg.types.setTypeParser(20, (v) => Number(v));

const { DATABASE_URL, DB_ROLE, DB_PASSWORD, DB_HOST, DB_PORT, SUPABASE_REF } = process.env;
if (!DATABASE_URL && (!DB_PASSWORD || !DB_HOST || !SUPABASE_REF)) {
  throw new Error("Configuration base de données manquante : définis DATABASE_URL (ou le fichier .env.db).");
}

// Sur Vercel : DATABASE_URL = chaîne « Transaction pooler » de Supabase (port 6543).
const serverless = !!process.env.VERCEL;
export const pool = new pg.Pool({
  ...(DATABASE_URL
    ? { connectionString: DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, "") }
    : {
        host: DB_HOST,
        port: Number(DB_PORT || 5432),
        user: `${DB_ROLE || "coursscribe_app"}.${SUPABASE_REF}`,
        password: DB_PASSWORD,
        database: "postgres",
      }),
  ssl: { rejectUnauthorized: false },
  max: serverless ? 3 : 8,
  idleTimeoutMillis: serverless ? 10_000 : 30_000,
  connectionTimeoutMillis: 15_000,
});
pool.on("error", (e) => console.error("pg pool error", e.message));

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}
export async function one<T = any>(text: string, params: any[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}
