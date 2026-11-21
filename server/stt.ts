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
