/**
 * Transcription audio (speech-to-text) avec Gemini.
 * - Micro en direct : courts extraits envoyés directement (transcribeInline).
 * - Fichier importé : téléversement fractionné vers l'API Files de Gemini, puis
 *   transcription par fenêtres de quelques minutes pilotée par le navigateur
 *   (chaque requête reste courte : compatible avec les fonctions Vercel).
 */
import { q, one } from "./db";
import { transcribeInline, transcribeWindow, startResumableUpload, uploadChunk, getFile, deleteFile } from "./gemini";

export async function transcribeAudio(audio: Buffer, mime: string, context = "", userId: number | null = null) {
  // Estimation de la durée de l'extrait (Opus ~32-48 kbit/s) pour le suivi des coûts.
  const approxSec = Math.min(30, Math.max(1, audio.length / 5000));
  return transcribeInline(audio, mime, context, userId, approxSec);
}

/** Nettoie le texte renvoyé par le modèle. */
export function cleanTranscript(t: string) {
  return t
    .replace(/^["«»\s]+|["«»\s]+$/g, "")
    .replace(/\[(silence|inaudible|musique|bruit)[^\]]*\]/gi, "")
    .replace(/[\[(]\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?)?[\])]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------- Import d'un fichier audio ----------

export const IMPORT_CHUNK = 4 * 1024 * 1024; // multiple de 256 Kio, sous la limite de 4,5 Mo de Vercel
export const IMPORT_MAX_BYTES = 500 * 1024 * 1024;

type ImportJob = { id: number; user_id: number; upload_url: string; size: number; mime: string; file_name: string | null; file_uri: string | null; pending: Buffer | null; sent: number; granularity: number };

export async function createImport(userId: number, size: number, mime: string, name: string) {
  // Nettoyage des imports de plus de 24 h
  const old = await q<ImportJob>(`delete from public.import_jobs where created_at < $1 returning file_name`, [Date.now() - 86400_000]);
  for (const o of old) if (o.file_name) void deleteFile(o.file_name);
  const { url, granularity } = await startResumableUpload(size, mime, name || "cours");
  const row = await one<{ id: number }>(
    `insert into public.import_jobs (user_id, upload_url, size, mime, granularity, created_at) values ($1, $2, $3, $4, $5, $6) returning id`,
    [userId, url, size, mime, granularity, Date.now()],
  );
  return row!.id;
}

async function getImport(id: number, userId: number) {
  return one<ImportJob>(`select * from public.import_jobs where id = $1 and user_id = $2`, [id, userId]);
}

/**
 * Reçoit un morceau de 4 Mo du navigateur. Google impose des envois multiples de sa
 * « granularité » (8 Mo) : le reste est gardé en base jusqu'au morceau suivant,
 * ce qui fonctionne même si chaque requête arrive sur une instance serveur différente.
 */
export async function importChunk(id: number, userId: number, offset: number, chunk: Buffer) {
  const job = await getImport(id, userId);
  if (!job) return { error: "Import introuvable." as const };
  const pending = job.pending ? Buffer.from(job.pending) : Buffer.alloc(0);
  const expected = job.sent + pending.length;
  if (offset !== expected) {
    if (offset < expected && offset + chunk.length <= expected) return { done: false, received: expected }; // morceau déjà reçu (nouvel essai)
    return { error: `Morceau inattendu (attendu à ${expected}).` as const };
  }
  const buf = Buffer.concat([pending, chunk]);
  const last = expected + chunk.length >= job.size;
  const gran = job.granularity || 8 * 1024 * 1024;
  const sendLen = last ? buf.length : Math.floor(buf.length / gran) * gran;
  if (sendLen > 0) {
    const file = await uploadChunk(job.upload_url, job.sent, buf.subarray(0, sendLen), last);
    if (file) {
      await q(`update public.import_jobs set file_name = $1, file_uri = $2, mime = $3, pending = null, sent = $4 where id = $5`, [
        file.name, file.uri, file.mimeType || job.mime, job.size, id,
      ]);
      return { done: true, state: file.state };
    }
  }
  await q(`update public.import_jobs set pending = $1, sent = $2 where id = $3`, [buf.length > sendLen ? buf.subarray(sendLen) : null, job.sent + sendLen, id]);
  return { done: false, received: expected + chunk.length };
}

export async function importStatus(id: number, userId: number) {
  const job = await getImport(id, userId);
  if (!job || !job.file_name) return { state: "MISSING" };
  const f = await getFile(job.file_name);
  return { state: f.state };
}

export async function importTranscribePart(id: number, userId: number, start: number, end: number, duration: number, context: string) {
  const job = await getImport(id, userId);
  if (!job || !job.file_uri) return { error: "Import introuvable." as const };
  const text = cleanTranscript(await transcribeWindow(job.file_uri, job.mime, start, end, duration || end, context, userId));
  return { text };
}

export async function finishImport(id: number, userId: number) {
  const job = await getImport(id, userId);
  if (!job) return;
  if (job.file_name) await deleteFile(job.file_name);
  await q(`delete from public.import_jobs where id = $1`, [id]);
}
