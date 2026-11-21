import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { randomBytes } from "node:crypto";

/**
 * Transcription audio réelle (speech-to-text) via un worker Python persistant
 * (SDK LLM API, modèle Gemini). Le worker est démarré à la première requête
 * et relancé automatiquement s'il s'arrête.
 */
let proc: ChildProcessWithoutNullStreams | null = null;
const pending = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

function ensureWorker() {
  if (proc && proc.exitCode === null) return proc;
  const script = path.resolve("server/py/stt_worker.py");
  const p = spawn(process.env.PYTHON_BIN || "python3", [script], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  const rl = readline.createInterface({ input: p.stdout });
  rl.on("line", (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg?.id) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(String(msg.text || ""));
  });
  p.stderr.on("data", (d) => console.error("[stt]", String(d).slice(0, 400)));
  p.on("exit", () => {
    pending.forEach((e) => {
      clearTimeout(e.timer);
      e.reject(new Error("Le service de transcription s'est arrêté."));
    });
    pending.clear();
    proc = null;
  });
  proc = p;
  return p;
}

function once(audio: Buffer, mime: string, context: string): Promise<string> {
  const p = ensureWorker();
  const id = randomBytes(8).toString("hex");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Délai de transcription dépassé."));
    }, 45000);
    pending.set(id, { resolve, reject, timer });
    p.stdin.write(JSON.stringify({ id, b64: audio.toString("base64"), mime, context }) + "\n");
  });
}

export async function transcribeAudio(audio: Buffer, mime: string, context = ""): Promise<string> {
  try {
    return await once(audio, mime, context);
  } catch {
    // Un second essai suffit généralement (délai ponctuel du fournisseur).
    return await once(audio, mime, context);
  }
}

/** Nettoie le texte renvoyé par le modèle. */
export function cleanTranscript(t: string) {
  return t
    .replace(/^["«»\s]+|["«»\s]+$/g, "")
    .replace(/\[(silence|inaudible|musique|bruit)[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------- Import d'un fichier audio complet ----------

type FileJob = {
  id: string;
  userId: number;
  status: "running" | "done" | "error";
  done: number;
  total: number;
  durationSec: number;
  text: string;
  error?: string;
  createdAt: number;
};
const jobs = new Map<string, FileJob>();
const SEGMENT_SEC = 50;

function run(cmd: string, args: string[]) {
  return new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(-300))) : resolve(String(stdout)),
    ),
  );
}

export function startFileJob(userId: number, data: Buffer, mime: string, context: string) {
  const id = randomBytes(10).toString("hex");
  const job: FileJob = { id, userId, status: "running", done: 0, total: 0, durationSec: 0, text: "", createdAt: Date.now() };
  jobs.set(id, job);
  // Nettoyage des anciennes tâches (1 h)
  jobs.forEach((j, k) => {
    if (Date.now() - j.createdAt > 3600_000) jobs.delete(k);
  });
  processFile(job, data, mime, context).catch((e) => {
    job.status = "error";
    job.error = e?.message?.includes("Invalid data") ? "Format audio non reconnu." : "La transcription du fichier a échoué.";
    console.error("file job", e?.message);
  });
  return id;
}

async function processFile(job: FileJob, data: Buffer, _mime: string, context: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-audio-"));
  try {
    const input = path.join(dir, "input");
    fs.writeFileSync(input, data);
    const dur = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input])).trim()) || 0;
    job.durationSec = Math.round(dur);
    if (dur > 4 * 3600) throw new Error("Fichier trop long (4 h maximum).");
    await run("ffmpeg", [
      "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
      "-f", "segment", "-segment_time", String(SEGMENT_SEC), "-reset_timestamps", "1", path.join(dir, "seg%04d.mp3"),
    ]);
    const segs = fs.readdirSync(dir).filter((f) => f.startsWith("seg")).sort();
    job.total = segs.length;
    const out: string[] = new Array(segs.length).fill("");
    let next = 0;
    const worker = async () => {
      while (next < segs.length) {
        const i = next++;
        const buf = fs.readFileSync(path.join(dir, segs[i]));
        try {
          out[i] = cleanTranscript(await transcribeAudio(buf, "audio/mp3", context));
        } catch {
          out[i] = "";
        }
        job.done++;
        // Texte partiel affiché au fil de l'eau (préfixe contigu)
        job.text = out.filter(Boolean).join(" ");
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, segs.length) }, worker));
    job.text = out.filter(Boolean).join(" ");
    job.status = "done";
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function getFileJob(id: string, userId: number) {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return undefined;
  const { userId: _u, ...rest } = j;
  return rest;
}
