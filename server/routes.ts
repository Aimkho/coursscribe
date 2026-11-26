import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import type { Server } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { storage, toCourse, toSummary } from "./storage";
import { registerSchema, loginSchema, courseInputSchema, coursePatchSchema, subjectInputSchema } from "@shared/schema";
import type { User, Exam, ExamGrade } from "@shared/schema";
import { transcribeAudio, cleanTranscript, createImport, importChunk, importStatus, importTranscribePart, finishImport, IMPORT_CHUNK, IMPORT_MAX_BYTES } from "./stt";
import { audioKey, signedUploadUrl, signedDownloadUrl, removeCourseAudio, fetchStored, removeKeys } from "./audioStore";
import { geminiConfigured, readStatement } from "./gemini";
import { buildBlocks, ALL_PARTS, safeFileName, type ExportPart } from "./export/blocks";
import { renderPdf } from "./export/pdf";
import { renderDocx } from "./export/docx";
import { renderPptx } from "./export/pptx";
import { billingState, quotaError, verifyStripeSignature, handleStripeEvent, checkoutUrl, portalUrl, PLANS, invalidateBilling } from "./billing";
import { generateNotes, generateSheet, generateExercises, generateExam, gradeOpenAnswers, generateClassExercises, classExercisesBrief, verifyStudySet } from "./ai";

/** Version du texte de consentement : l'incrémenter redemande l'accord à tous les utilisateurs. */
export const CONSENT_VERSION = 1;

/** Journal d'erreurs : console (Vercel) + fichier local si le disque est accessible. */
function logErr(line: string) {
  console.error(line);
  try {
    fs.appendFileSync("gen-errors.log", `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* disque en lecture seule (Vercel) */
  }
}

function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const test = scryptSync(pw, salt, 64);
  const buf = Buffer.from(hash, "hex");
  return buf.length === test.length && timingSafeEqual(buf, test);
}

type AuthedRequest = Request & { user?: User; token?: string };

async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token as string) || "";
  try {
    const user = token ? await storage.getSessionUser(token) : undefined;
    if (!user) return res.status(401).json({ message: "Session expirée. Reconnecte-toi." });
    req.user = user;
    req.token = token;
    next();
  } catch (e: any) {
    console.error("auth db error", e?.message);
    res.status(503).json({ message: "Base de données momentanément injoignable. Réessaie dans un instant." });
  }
}

// Enveloppe async : toute erreur devient une réponse 500 propre.
const h =
  (fn: (req: AuthedRequest, res: Response) => Promise<any>) =>
  (req: AuthedRequest, res: Response) =>
    fn(req, res).catch((e: any) => {
      console.error("route error", req.method, req.path, e?.message);
      logErr(`${req.method} ${req.path} ${e?.stack || e?.message}`);
      if (!res.headersSent) res.status(500).json({ message: "Erreur serveur. Réessaie." });
    });

async function redirectAudio(req: Request, res: Response, key: string, baseName: string) {
  const url = await signedDownloadUrl(key, 6 * 3600);
  if (!url) return res.status(404).end();
  res.setHeader("Cache-Control", "private, no-store");
  res.redirect(302, req.query.download ? `${url}&download=${encodeURIComponent(baseName)}` : url);
}
const wc = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

function publicUser(u: User) {
  const ok = !!u.aiConsentAt && (u.aiConsentVersion ?? 0) >= CONSENT_VERSION;
  return { id: u.id, name: u.name, email: u.email, aiConsent: ok ? { at: u.aiConsentAt!, version: u.aiConsentVersion! } : null };
}

/** Bloque l'envoi de données à l'IA tant que l'utilisateur n'a pas donné son accord. */
function requireConsent(req: AuthedRequest, res: Response, next: NextFunction) {
  const u = req.user!;
  if (!u.aiConsentAt || (u.aiConsentVersion ?? 0) < CONSENT_VERSION)
    return res.status(403).json({ code: "consent_required", message: "Accepte d'abord le traitement de tes données par l'IA (écran Confidentialité)." });
  if (!geminiConfigured()) return res.status(503).json({ message: "L'IA n'est pas configurée sur ce serveur (clé GEMINI_API_KEY manquante)." });
  next();
}

function zodMessage(err: any) {
  return err?.issues?.[0]?.message || "Données invalides";
}

const arr = (v: any) => (Array.isArray(v) ? v : []);
const str = (v: any) => (typeof v === "string" ? v : v == null ? "" : String(v));

function normalizeMethods(v: any) {
  return arr(v)
    .map((m: any) => ({ title: str(m?.title), when: str(m?.when), steps: arr(m?.steps).map(str).filter(Boolean) }))
    .filter((m: any) => m.title && m.steps.length);
}
function normalizeNotes(n: any) {
  return {
    title: str(n.title),
    central_idea: str(n.central_idea),
    summary: str(n.summary),
    keywords: arr(n.keywords).map(str),
    plan: arr(n.plan).map((p: any) => ({ heading: str(p.heading), points: arr(p.points).map(str), explanation: str(p.explanation) })),
    definitions: arr(n.definitions).map((d: any) => ({ term: str(d.term), definition: str(d.definition) })),
    examples: arr(n.examples).map((d: any) => ({ title: str(d.title), explanation: str(d.explanation) })),
    formulas: arr(n.formulas).map((d: any) => ({ label: str(d.label), expression: str(d.expression), meaning: str(d.meaning) })),
    discipline: str(n.discipline),
    methods: normalizeMethods(n.methods),
    tables: normalizeTables(n.tables, 8),
    student_questions: arr(n.student_questions).map((d: any) => ({ question: str(d.question), answer: str(d.answer) })),
    to_verify: arr(n.to_verify).map(str),
  };
}
function normalizeSheet(s: any) {
  return {
    essentials: arr(s.essentials).map(str),
    concept_links: arr(s.concept_links).map((c: any) => ({ concept: str(c.concept), links: arr(c.links).map(str) })),
    memory_tips: arr(s.memory_tips).map(str),
    common_mistakes: arr(s.common_mistakes).map(str),
    flashcards: arr(s.flashcards).map((f: any) => ({ front: str(f.front), back: str(f.back) })),
    checklist: arr(s.checklist).map(str),
    formulas: arr(s.formulas).map((d: any) => ({ label: str(d.label), expression: str(d.expression), meaning: str(d.meaning) })).filter((d: any) => d.label || d.expression),
    methods: normalizeMethods(s.methods),
    tables: normalizeTables(s.tables, 6),
  };
}
const TYPES = ["qcm", "vrai_faux", "ouverte", "application", "cas_pratique"];
const DIFFS = ["facile", "moyen", "difficile"];
function normalizeTables(v: any, max = 4) {
  return arr(v)
    .map((t: any) => {
      const headers = arr(t?.headers).map(str);
      const width = Math.max(headers.length, ...arr(t?.rows).map((r: any) => arr(r).length), 0);
      if (!width) return null;
      const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")].slice(0, width);
      return { title: str(t?.title), headers: headers.length ? pad(headers) : [], rows: arr(t?.rows).map((r: any) => pad(arr(r).map(str))).filter((r: string[]) => r.some(Boolean)).slice(0, 40) };
    })
    .filter((t: any) => t && t.rows.length)
    .slice(0, max);
}
function normalizeExercises(e: any) {
  return {
    discipline: str(e.discipline),
    items: arr(e.items)
      .map((i: any) => ({
        type: TYPES.includes(i.type) ? i.type : "ouverte",
        difficulty: DIFFS.includes(i.difficulty) ? i.difficulty : "moyen",
        question: str(i.question),
        options: i.options ? arr(i.options).map(str) : undefined,
        answer_index: typeof i.answer_index === "number" ? i.answer_index : undefined,
        answer_bool: typeof i.answer_bool === "boolean" ? i.answer_bool : undefined,
        model_answer: str(i.model_answer),
        explanation: str(i.explanation),
        tables: normalizeTables(i.tables),
        answer_tables: normalizeTables(i.answer_tables),
      }))
      .filter((i: any) => i.question && (i.type !== "qcm" || (i.options?.length >= 2 && i.answer_index !== undefined))),
  };
}
function normalizeExam(x: any): Exam {
  let n = 0;
  return {
    discipline: str(x.discipline),
    title: str(x.title) || "Examen blanc",
    duration_minutes: Number(x.duration_minutes) > 0 ? Math.min(240, Number(x.duration_minutes)) : 45,
    instructions: str(x.instructions),
    sections: arr(x.sections).map((s: any) => ({
      title: str(s.title),
      questions: arr(s.questions)
        .map((q: any) => ({
          id: `q${++n}`,
          type: q.type === "qcm" ? "qcm" : q.type === "cas_pratique" ? "cas_pratique" : "ouverte",
          question: str(q.question),
          options: q.type === "qcm" ? arr(q.options).map(str) : undefined,
          answer_index: typeof q.answer_index === "number" ? q.answer_index : undefined,
          points: Number(q.points) > 0 ? Number(q.points) : 1,
          model_answer: str(q.model_answer),
          grading_criteria: arr(q.grading_criteria).map(str),
          tables: normalizeTables(q.tables),
          answer_tables: normalizeTables(q.answer_tables),
        }))
        .filter((q: any) => q.question && (q.type !== "qcm" || (q.options?.length >= 2 && q.answer_index !== undefined))),
    })).filter((s: any) => s.questions.length),
  } as Exam;
}

/** Résumé d'une série déjà générée, transmis à l'IA pour qu'elle produise une série différente. */
function previousBrief(kind: string, data: any): string {
  const items: any[] = kind === "exam" ? arr(data?.sections).flatMap((s: any) => arr(s.questions)) : arr(data?.items);
  return items
    .filter((i) => i.type !== "qcm" && i.type !== "vrai_faux")
    .map((i) => `[${i.type}] ${str(i.question).replace(/\s+/g, " ").slice(0, 260)}`)
    .join("\n")
    .slice(0, 3500);
}

const FIX_FIELDS = ["question", "options", "answer_index", "answer_bool", "model_answer", "explanation", "tables", "answer_tables", "grading_criteria"];
async function verifyAndFix(kind: "exercises" | "exam", meta: { title: string; subject: string; level: string }, notes: unknown, data: any, userId: number) {
  const items: any[] = kind === "exam" ? data.sections.flatMap((s: any) => s.questions) : data.items;
  try {
    const out = await verifyStudySet(kind, meta, notes, items, userId);
    let applied = 0;
    for (const f of arr(out?.fixes)) {
      const it = items[Number(f?.index)];
      if (!it) continue;
      for (const k of FIX_FIELDS) {
        if (f[k] === undefined || f[k] === null) continue;
        if (k === "tables" || k === "answer_tables") it[k] = normalizeTables(f[k]);
        else if (k === "options" || k === "grading_criteria") it[k] = arr(f[k]).map(str);
        else if (k === "answer_index") { if (typeof f[k] === "number" && f[k] >= 0 && f[k] < (it.options?.length ?? 0)) it[k] = f[k]; }
        else if (k === "answer_bool") { if (typeof f[k] === "boolean") it[k] = f[k]; }
        else if (str(f[k]).trim()) it[k] = str(f[k]);
      }
      applied++;
    }
    console.log(`verify ${kind}: ${arr(out?.checks).length} vérifiés, ${applied} correction(s) ${arr(out?.fixes).map((f: any) => `[${f.index}] ${str(f.problem).slice(0, 160)}`).join(" | ")}`);
  } catch (e: any) {
    logErr(`verify ${kind} ${e?.status ?? ""} ${e?.message}`);
  }
  return data;
}

const STATEMENT_SOURCES = ["photo", "transcription", "photo_et_transcription"];
function normalizeClassExercises(x: any, attIds: Set<number>) {
  return {
    items: arr(x.items)
      .map((e: any, i: number) => ({
        number: Number(e.number) > 0 ? Math.round(Number(e.number)) : i + 1,
        title: str(e.title) || `Exercice ${i + 1}`,
        reference: /^exercice\s*n?°?\s*\d+\.?$/i.test(str(e.reference)) ? "" : str(e.reference),
        statement: str(e.statement),
        statement_source: STATEMENT_SOURCES.includes(e.statement_source) ? e.statement_source : "transcription",
        statement_complete: e.statement_complete !== false,
        correction: arr(e.correction).map((c: any) => ({ step: str(c.step), detail: str(c.detail) })).filter((c: any) => c.step || c.detail),
        final_answer: str(e.final_answer),
        method: arr(e.method).map(str).filter(Boolean),
        pitfalls: arr(e.pitfalls).map(str).filter(Boolean),
        missing: str(e.missing),
        attachment_ids: arr(e.attachment_ids).map(Number).filter((n: number) => attIds.has(n)),
      }))
      .map((e: any) => (e.attachment_ids.length && e.statement_source === "transcription" ? { ...e, statement_source: "photo_et_transcription" } : e))
      .filter((e: any) => e.statement || e.correction.length),
  };
}

const ATT_MIMES: Record<string, "image" | "pdf"> = { "image/jpeg": "image", "image/png": "image", "image/webp": "image", "application/pdf": "pdf" };
const ATT_MAX = 15 * 1024 * 1024;

const running = new Set<string>();

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ---------- Auth ----------
  app.post("/api/auth/register", h(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const { name, email, password } = parsed.data;
    if (await storage.getUserByEmail(email)) return res.status(409).json({ message: "Un compte existe déjà avec cette adresse e-mail." });
    const user = await storage.createUser({ name, email, passwordHash: hashPassword(password) });
    const token = randomBytes(32).toString("hex");
    await storage.createSession(token, user.id);
    res.json({ token, user: publicUser(user) });
  }));

  app.post("/api/auth/login", h(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const user = await storage.getUserByEmail(parsed.data.email);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash))
      return res.status(401).json({ message: "E-mail ou mot de passe incorrect." });
    const token = randomBytes(32).toString("hex");
    await storage.createSession(token, user.id);
    res.json({ token, user: publicUser(user) });
  }));

  app.post("/api/auth/logout", auth, h(async (req, res) => {
    await storage.deleteSession(req.token!);
    res.json({ ok: true });
  }));

  // Transfert de session vers un nouvel onglet (code à usage unique, 2 minutes).
  app.post("/api/auth/handoff", auth, h(async (req, res) => {
    const code = randomBytes(24).toString("hex");
    await storage.createHandoff(code, req.user!.id, Date.now() + 120_000);
    res.json({ code });
  }));
  app.post("/api/auth/handoff/redeem", h(async (req, res) => {
    const code = String(req.body?.code || "");
    const userId = code ? await storage.redeemHandoff(code) : undefined;
    if (!userId) return res.status(401).json({ message: "Lien expiré. Reconnecte-toi." });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Compte introuvable." });
    const token = randomBytes(32).toString("hex");
    await storage.createSession(token, user.id);
    res.json({ token, user: publicUser(user) });
  }));

  app.get("/api/auth/me", auth, (req: AuthedRequest, res) => res.json(publicUser(req.user!)));

  // ---------- Consentement et données personnelles (RGPD) ----------
  app.post("/api/consent", auth, h(async (req, res) => {
    const b = req.body || {};
    if (b.ai !== true || b.age !== true || b.recording !== true)
      return res.status(400).json({ message: "Les trois cases doivent être cochées pour utiliser l'IA." });
    await storage.setConsent(req.user!.id, CONSENT_VERSION);
    res.json(publicUser((await storage.getUser(req.user!.id))!));
  }));

  app.delete("/api/consent", auth, h(async (req, res) => {
    await storage.setConsent(req.user!.id, null);
    res.json(publicUser((await storage.getUser(req.user!.id))!));
  }));

  app.get("/api/account/export", auth, h(async (req, res) => {
    const rows = await storage.listMyCourses(req.user!.id);
    const courses = await Promise.all(rows.map((r) => toCourse(r, req.user!.id)));
    res.setHeader("Content-Disposition", `attachment; filename="coursscribe-mes-donnees.json"`);
    res.json({ exportedAt: new Date().toISOString(), user: publicUser(req.user!), subjects: await storage.listSubjects(req.user!.id), courses });
  }));

  app.delete("/api/account", auth, h(async (req, res) => {
    const pw = String(req.body?.password || "");
    if (!verifyPassword(pw, req.user!.passwordHash)) return res.status(401).json({ message: "Mot de passe incorrect." });
    const ids = await storage.listCourseIds(req.user!.id);
    await Promise.all(ids.map((id) => removeCourseAudio(id)));
    await storage.deleteUser(req.user!.id);
    res.json({ ok: true });
  }));

  // ---------- Abonnement (Stripe) ----------
  app.post("/api/stripe/webhook", async (req: any, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const raw: Buffer | undefined = Buffer.isBuffer(req.rawBody) ? req.rawBody : undefined;
    const sig = String(req.headers["stripe-signature"] || "");
    if (!secret || !raw || !verifyStripeSignature(raw, sig, secret)) return res.status(400).json({ message: "Signature invalide." });
    try {
      const r = await handleStripeEvent(JSON.parse(raw.toString("utf8")));
      res.json({ received: true, result: r });
    } catch (e: any) {
      logErr(`stripe webhook ${e?.message}`);
      res.status(500).json({ message: "Erreur de traitement." });
    }
  });

  app.get("/api/billing", auth, h(async (req, res) => {
    const u = req.user!;
    const state = await billingState(u, req.query.fresh === "1");
    res.json({
      ...state,
      plans: PLANS,
      checkout: { week: checkoutUrl("week", u), month: checkoutUrl("month", u), year: checkoutUrl("year", u) },
      portal: portalUrl(u),
    });
  }));

  // ---------- Matières ----------
  app.get("/api/subjects", auth, h(async (req, res) => {
    res.json(await storage.listSubjects(req.user!.id));
  }));

  app.post("/api/subjects", auth, h(async (req, res) => {
    const parsed = subjectInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    res.json(await storage.findOrCreateSubject(req.user!.id, parsed.data.name, parsed.data.level));
  }));

  app.patch("/api/subjects/:id", auth, h(async (req, res) => {
    const parsed = subjectInputSchema.partial().safeParse(req.body);
    if (!parsed.success || !parsed.data.name) return res.status(400).json({ message: "Nom de la matière requis" });
    const r = await storage.renameSubject(Number(req.params.id), req.user!.id, parsed.data.name, parsed.data.level);
    if (!r) return res.status(404).json({ message: "Matière introuvable." });
    res.json({ ok: true });
  }));

  app.delete("/api/subjects/:id", auth, h(async (req, res) => {
    const ok = await storage.deleteSubject(Number(req.params.id), req.user!.id);
    if (!ok) return res.status(404).json({ message: "Matière introuvable." });
    res.json({ ok: true });
  }));

  app.get("/api/subjects/:id/next-chapter", auth, h(async (req, res) => {
    const s = await storage.getSubject(Number(req.params.id), req.user!.id);
    if (!s) return res.status(404).json({ message: "Matière introuvable." });
    res.json({ next: await storage.nextChapterNumber(s.id) });
  }));

  // ---------- Cours ----------
  app.get("/api/courses", auth, h(async (req, res) => {
    res.json((await storage.listMyCourses(req.user!.id)).map((c) => toSummary(c, req.user!.id)));
  }));

  app.get("/api/library", auth, h(async (req, res) => {
    res.json((await storage.listPublicCourses()).map((c) => toSummary(c, req.user!.id)));
  }));

  /** Résout la matière : id existant (appartenant à l'utilisateur) ou nom libre (créée si besoin). */
  async function resolveSubject(userId: number, subjectId: number | null | undefined, name: string | undefined, level: string) {
    if (subjectId) {
      const s = await storage.getSubject(subjectId, userId);
      if (s) return s;
    }
    if (name && name.trim()) return storage.findOrCreateSubject(userId, name, level);
    return null;
  }

  app.post("/api/courses", auth, h(async (req, res) => {
    const parsed = courseInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const d = parsed.data;
    const subj = await resolveSubject(req.user!.id, d.subjectId, d.subject, d.level);
    const chapter = subj ? d.chapterNumber ?? (await storage.nextChapterNumber(subj.id)) : d.chapterNumber ?? null;
    const row = await storage.createCourse({
      ownerId: req.user!.id,
      title: d.title,
      subject: subj?.name ?? d.subject,
      level: d.level || subj?.level || "",
      transcript: d.transcript,
      durationSec: d.durationSec,
      subjectId: subj?.id ?? null,
      chapterNumber: chapter,
    });
    res.json(await toCourse(row, req.user!.id));
  }));

  async function viewable(req: AuthedRequest, res: Response) {
    const row = await storage.getCourse(Number(req.params.id));
    if (!row || (row.ownerId !== req.user!.id && !row.isPublic)) {
      res.status(404).json({ message: "Cours introuvable ou privé." });
      return undefined;
    }
    return row;
  }
  async function owned(req: AuthedRequest, res: Response) {
    const row = await storage.getCourse(Number(req.params.id));
    if (!row || row.ownerId !== req.user!.id) {
      res.status(404).json({ message: "Cours introuvable." });
      return undefined;
    }
    return row;
  }

  app.get("/api/courses/:id", auth, h(async (req, res) => {
    const row = await viewable(req, res);
    if (row) res.json(await toCourse(row, req.user!.id));
  }));

  app.patch("/api/courses/:id", auth, h(async (req, res) => {
    const parsed = coursePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const row = await owned(req, res);
    if (!row) return;
    const patch: Record<string, any> = { ...parsed.data };
    if (parsed.data.subjectId !== undefined || parsed.data.subject !== undefined) {
      if (parsed.data.subjectId === null && !parsed.data.subject) {
        patch.subjectId = null;
      } else {
        const subj = await resolveSubject(req.user!.id, parsed.data.subjectId, parsed.data.subject, parsed.data.level ?? row.level);
        patch.subjectId = subj?.id ?? null;
        patch.subject = subj?.name ?? parsed.data.subject ?? "";
        if (subj && subj.id !== row.subjectId && parsed.data.chapterNumber === undefined)
          patch.chapterNumber = await storage.nextChapterNumber(subj.id);
      }
    }
    const updated = await storage.updateCourse(row.id, req.user!.id, patch);
    if (!updated) return res.status(404).json({ message: "Cours introuvable." });
    res.json(await toCourse(updated, req.user!.id));
  }));

  app.delete("/api/courses/:id", auth, h(async (req, res) => {
    const id = Number(req.params.id);
    const sessions = await storage.listCourseSessions(id).catch(() => []);
    const ok = await storage.deleteCourse(id, req.user!.id);
    if (!ok) return res.status(404).json({ message: "Cours introuvable." });
    void sessions;
    await removeCourseAudio(id);
    res.json({ ok: true });
  }));

  // ---------- Séances (un cours peut s'étaler sur plusieurs jours) ----------
  app.post("/api/courses/:id/sessions", auth, h(async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const session = await storage.createCourseSession(row.id, Date.now());
    if (row.status === "termine") await storage.updateCourse(row.id, req.user!.id, { status: "en_cours" });
    res.json(session);
  }));

  // Sauvegarde (automatique ou finale) d'une séance : texte complet du cours + durée de la séance.
  app.put("/api/courses/:id/sessions/:sid", auth, h(async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const sid = Number(req.params.sid);
    const transcript = typeof req.body?.transcript === "string" ? req.body.transcript.slice(0, 400000) : undefined;
    const durationSec = Math.max(0, Math.min(43200, Math.round(Number(req.body?.durationSec) || 0)));
    const sessionWords = Math.max(0, Math.round(Number(req.body?.wordCount) || 0));
    const session = await storage.updateCourseSession(row.id, sid, { durationSec, wordCount: sessionWords });
    if (!session) return res.status(404).json({ message: "Séance introuvable." });
    if (transcript !== undefined && transcript !== row.transcript) await storage.updateCourse(row.id, req.user!.id, { transcript });
    await storage.recomputeDuration(row.id);
    res.json({ ok: true, savedAt: Date.now(), session });
  }));

  // L'audio est envoyé directement par le navigateur vers Supabase Storage (URL signée).
  app.post("/api/courses/:id/sessions/:sid/audio-upload", auth, h(async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const s = await storage.getCourseSession(row.id, Number(req.params.sid));
    if (!s) return res.status(404).json({ message: "Séance introuvable." });
    res.json({ url: await signedUploadUrl(audioKey(row.id, s.id)) });
  }));

  app.post("/api/courses/:id/sessions/:sid/audio-done", auth, h(async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const sid = Number(req.params.sid);
    const s = await storage.getCourseSession(row.id, sid);
    if (!s) return res.status(404).json({ message: "Séance introuvable." });
    await storage.updateCourseSession(row.id, sid, { hasAudio: true });
    await storage.updateCourse(row.id, req.user!.id, { hasAudio: true, transcriptUpdatedAt: row.transcriptUpdatedAt });
    res.json({ ok: true });
  }));

  app.get("/api/courses/:id/sessions/:sid/audio", auth, h(async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    await redirectAudio(req, res, audioKey(row.id, Number(req.params.sid)), `cours-${row.id}-seance-${req.params.sid}`);
  }));

  // ---------- Énoncés d'exercices (photos, PDF) ----------
  app.post("/api/courses/:id/attachments", auth, h(async (req: AuthedRequest, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const mime = String(req.body?.mime || "");
    const size = Number(req.body?.size) || 0;
    const kind = ATT_MIMES[mime];
    if (!kind) return res.status(400).json({ message: "Format non pris en charge : envoie une photo (JPEG, PNG) ou un PDF." });
    if (size <= 0 || size > ATT_MAX) return res.status(400).json({ message: "Fichier trop lourd (15 Mo maximum)." });
    const count = (await storage.listAttachments(row.id)).length;
    if (count >= 40) return res.status(400).json({ message: "40 énoncés maximum par cours." });
    const exerciseNo = Number(req.body?.exerciseNo) > 0 ? Math.round(Number(req.body.exerciseNo)) : null;
    const sessionId = Number(req.body?.sessionId) > 0 ? Number(req.body.sessionId) : null;
    const { id, key } = await storage.createAttachment({ courseId: row.id, sessionId, exerciseNo, kind, mime, size, label: str(req.body?.label).slice(0, 120) });
    res.json({ id, url: await signedUploadUrl(key) });
  }));

  // Fichier reçu par le stockage : l'IA lit l'énoncé.
  app.post("/api/courses/:id/attachments/:aid/done", auth, requireConsent, h(async (req: AuthedRequest, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const att = await storage.getAttachment(row.id, Number(req.params.aid));
    if (!att) return res.status(404).json({ message: "Énoncé introuvable." });
    const buf = await fetchStored(att.storageKey, ATT_MAX);
    if (!buf) return res.status(400).json({ message: "Le fichier n'est pas arrivé. Réessaie l'envoi." });
    await storage.updateAttachment(row.id, att.id, { uploaded: true });
    let extracted: string | null = null;
    try {
      extracted = await readStatement(buf, att.mime, [row.subject, row.title].filter(Boolean).join(" — "), req.user!.id);
    } catch (e: any) {
      logErr(`statement ${e?.status ?? ""} ${e?.message}`);
    }
    await storage.updateAttachment(row.id, att.id, { extracted });
    const fresh = await storage.getAttachment(row.id, att.id);
    res.json({ ...fresh, storageKey: undefined, sizeBytes: undefined, readError: extracted === null });
  }));

  app.get("/api/courses/:id/attachments/:aid/file", auth, h(async (req: AuthedRequest, res) => {
    const row = await viewable(req, res);
    if (!row) return;
    const att = await storage.getAttachment(row.id, Number(req.params.aid));
    if (!att || !att.uploaded) return res.status(404).end();
    await redirectAudio(req, res, att.storageKey, `enonce-${att.id}`);
  }));

  app.patch("/api/courses/:id/attachments/:aid", auth, h(async (req: AuthedRequest, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const patch: any = {};
    if (req.body?.exerciseNo !== undefined) patch.exerciseNo = Number(req.body.exerciseNo) > 0 ? Math.round(Number(req.body.exerciseNo)) : null;
    if (req.body?.label !== undefined) patch.label = str(req.body.label).slice(0, 120);
    if (req.body?.extracted !== undefined) patch.extracted = str(req.body.extracted).slice(0, 20000);
    await storage.updateAttachment(row.id, Number(req.params.aid), patch);
    res.json({ ok: true });
  }));

  app.delete("/api/courses/:id/attachments/:aid", auth, h(async (req: AuthedRequest, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const att = await storage.getAttachment(row.id, Number(req.params.aid));
    if (!att) return res.json({ ok: true });
    await storage.deleteAttachment(row.id, att.id);
    await removeKeys([att.storageKey]);
    res.json({ ok: true });
  }));

  // ---------- Exports PDF / Word / PowerPoint ----------
  app.get("/api/courses/:id/export/:format", auth, async (req: AuthedRequest, res) => {
    const row = await viewable(req, res);
    if (!row) return;
    const course = await toCourse(row, req.user!.id);
    const pick = <T,>(sets: { id: number; data: T }[], q: unknown) => sets.find((x) => x.id === Number(q))?.data;
    course.exercises = pick(course.exerciseSets, req.query.exSet) ?? course.exercises;
    course.exam = pick(course.examSets, req.query.examSet) ?? course.exam;
    const format = String(req.params.format);
    const requested = String(req.query.parts || ALL_PARTS.join(","))
      .split(",")
      .filter((p): p is ExportPart => (ALL_PARTS as string[]).includes(p));
    const parts = requested.length ? requested : ALL_PARTS;
    const withAnswers = req.query.answers !== "0";
    const base = safeFileName(course.title);
    try {
      if (format === "pptx") {
        if (!course.notes) return res.status(400).json({ message: "Génère d'abord les notes du cours pour créer la présentation." });
        const buf = await renderPptx(course);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.pptx"`);
        return res.send(buf);
      }
      const blocks = buildBlocks(course, parts, withAnswers);
      if (!blocks.length) return res.status(400).json({ message: "Rien à exporter : génère d'abord les notes, la fiche, les exercices ou l'examen." });
      if (format === "pdf") {
        const buf = await renderPdf(course, blocks);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
        return res.send(buf);
      }
      if (format === "docx") {
        const buf = await renderDocx(course, blocks);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.docx"`);
        return res.send(buf);
      }
      res.status(400).json({ message: "Format inconnu." });
    } catch (e: any) {
      logErr(`export ${format} ${e?.stack || e?.message}`);
      res.status(500).json({ message: "L'export a échoué. Réessaie." });
    }
  });

  // ---------- Transcription en direct (micro réel) ----------
  app.post(
    "/api/transcribe",
    auth,
    requireConsent,
    express.raw({ type: () => true, limit: "20mb" }),
    async (req: AuthedRequest, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length < 800) return res.json({ text: "" });
      const quota = await quotaError(req.user!, "audio").catch(() => null);
      if (quota) return res.status(402).json(quota);
      const mime = String(req.headers["content-type"] || "audio/webm").split(";")[0] || "audio/webm";
      const context = String(req.query.context || "").slice(0, 300);
      try {
        const text = cleanTranscript(await transcribeAudio(req.body, mime, context, req.user!.id));
        res.json({ text });
      } catch (e: any) {
        logErr(`stt ${e?.status ?? ""} ${e?.message}`);
        res.status(e?.status === 429 ? 429 : 502).json({ message: e?.status === 429 ? "Quota de l'IA atteint pour le moment. L'audio continue d'être enregistré." : "Transcription momentanément indisponible." });
      }
    },
  );

  // ---------- Audio (ancien format : un fichier par cours) ----------
  app.get("/api/courses/:id/audio", auth, h(async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    await redirectAudio(req, res, audioKey(row.id), `cours-${row.id}`);
  }));

  // ---------- Import d'un enregistrement audio (fichier du téléphone, dictaphone…) ----------
  // 1) start : ouvre un téléversement chez Gemini ; 2) chunk : morceaux de 4 Mo ;
  // 3) status : attend que le fichier soit prêt ; 4) part : transcrit une fenêtre de quelques minutes ; 5) delete.
  app.post("/api/import/start", auth, requireConsent, h(async (req, res) => {
    const size = Math.round(Number(req.body?.size) || 0);
    const mime = String(req.body?.mime || "").split(";")[0] || "audio/mpeg";
    if (size < 2000) return res.status(400).json({ message: "Fichier audio vide ou illisible." });
    if (size > IMPORT_MAX_BYTES) return res.status(400).json({ message: "Fichier trop volumineux (500 Mo maximum)." });
    const quota = await quotaError(req.user!, "audio");
    if (quota) return res.status(402).json(quota);
    const id = await createImport(req.user!.id, size, mime, String(req.body?.name || "cours"));
    res.json({ id, chunkSize: IMPORT_CHUNK });
  }));

  app.put(
    "/api/import/:id/chunk",
    auth,
    express.raw({ type: () => true, limit: "5mb" }),
    h(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: "Morceau vide." });
      const r = await importChunk(Number(req.params.id), req.user!.id, Math.max(0, Number(req.query.offset) || 0), req.body);
      if ("error" in r) return res.status(404).json({ message: r.error });
      res.json(r);
    }),
  );

  app.get("/api/import/:id/status", auth, h(async (req, res) => {
    res.json(await importStatus(Number(req.params.id), req.user!.id));
  }));

  app.post("/api/import/:id/part", auth, requireConsent, h(async (req, res) => {
    const start = Math.max(0, Number(req.body?.start) || 0);
    const end = Math.max(start + 1, Number(req.body?.end) || 0);
    const quota = await quotaError(req.user!, "audio", Math.min(end - start, 3600));
    if (quota) return res.status(402).json(quota);
    try {
      const r = await importTranscribePart(Number(req.params.id), req.user!.id, start, Math.min(end, start + 3600), Number(req.body?.duration) || 0, String(req.body?.context || "").slice(0, 300));
      if ("error" in r) return res.status(404).json({ message: r.error });
      res.json(r);
    } catch (e: any) {
      logErr(`import part ${e?.status ?? ""} ${e?.message}`);
      res.status(e?.status === 429 ? 429 : 502).json({ message: e?.status === 429 ? "Quota de l'IA atteint. Réessaie dans une minute." : "Un passage n'a pas pu être transcrit." });
    }
  }));

  app.delete("/api/import/:id", auth, h(async (req, res) => {
    await finishImport(Number(req.params.id), req.user!.id);
    res.json({ ok: true });
  }));

  // ---------- Génération IA ----------
  /**
   * Génération IA.
   * - notes, fiche, exercices du cours : réservés à l'auteur du cours.
   * - exercices et examens blancs : tout utilisateur qui peut consulter le cours (bibliothèque comprise).
   *   Chaque génération ajoute une nouvelle série (Série 1, Série 2…) visible par tous, sans modifier le cours.
   */
  app.post("/api/courses/:id/generate/:kind", auth, requireConsent, h(async (req: AuthedRequest, res) => {
    const kind = String(req.params.kind);
    if (!["notes", "sheet", "exercises", "exam", "class"].includes(kind)) return res.status(400).json({ message: "Type inconnu." });
    const isSet = kind === "exercises" || kind === "exam";
    const row = await storage.getCourse(Number(req.params.id));
    const isOwner = !!row && row.ownerId === req.user!.id;
    if (!row || (!isOwner && !(isSet && row.isPublic))) return res.status(404).json({ message: "Cours introuvable." });
    const words = row.transcript.trim().split(/\s+/).filter(Boolean).length;
    const atts = kind === "class" ? (await storage.listAttachments(row.id)).filter((a) => a.extracted) : [];
    if (words < 40 && !atts.length)
      return res.status(400).json({ message: `La transcription est trop courte (${words} mots). Il faut au moins 40 mots pour une analyse fiable.` });
    const quota = await quotaError(req.user!, "gen");
    if (quota) return res.status(402).json(quota);
    const key = isSet ? `${row.id}:${kind}:${req.user!.id}` : `${row.id}:${kind}`;
    if (running.has(key)) return res.status(409).json({ message: "Une génération est déjà en cours pour ce contenu." });
    running.add(key);
    const meta = { title: row.title, subject: row.subject, level: row.level };
    try {
      const started = Date.now();
      let notes = row.notes ?? null;
      const patch: any = {};
      if (kind === "class") {
        const raw = await generateClassExercises(
          meta,
          row.transcript,
          atts.map((a) => ({ id: a.id, exerciseNo: a.exerciseNo, label: a.label, text: a.extracted! })),
          req.user!.id,
        );
        patch.classExercises = normalizeClassExercises(raw, new Set(atts.map((a) => a.id)));
      } else if (kind === "notes" || !notes) {
        // Notes créées en préalable d'un autre contenu : non décomptées du quota (kind « notes_auto »).
        notes = normalizeNotes(await generateNotes(meta, row.transcript, req.user!.id, kind === "notes" ? "notes" : "notes_auto"));
        // Un lecteur de la bibliothèque ne modifie jamais le cours : ses notes servent seulement à cette génération.
        if (isOwner) {
          patch.notes = notes;
          patch.analyzedAt = started;
        }
      }
      if (kind === "sheet") patch.sheet = normalizeSheet(await generateSheet(meta, row.transcript, notes, req.user!.id));
      if (isSet) {
        const brief = classExercisesBrief(row.classExercises);
        const existing = (await storage.listSets(row.id, req.user!.id)).filter((x) => x.kind === kind);
        const n = (existing.at(-1)?.n ?? 0) + 1;
        const previous = existing.slice(-4).map((x) => previousBrief(kind, x.data));
        let data: any =
          kind === "exercises"
            ? normalizeExercises(await generateExercises(meta, row.transcript, notes, req.user!.id, brief, previous, n))
            : normalizeExam(await generateExam(meta, row.transcript, notes, req.user!.id, brief, previous, n));
        const count = kind === "exercises" ? data.items.length : data.sections.reduce((t: number, x: any) => t + x.questions.length, 0);
        if (!count) throw new Error("série vide");
        // Relecture indépendante des corrigés (calculs, réponses), si le temps le permet.
        if (Date.now() - started < 150_000) data = await verifyAndFix(kind, meta, notes, data, req.user!.id);
        await storage.createSet(row.id, kind, req.user!.id, data);
      }
      const updated = Object.keys(patch).length ? (await storage.updateCourse(row.id, row.ownerId, patch))! : (await storage.getCourse(row.id))!;
      invalidateBilling(req.user!.id);
      res.json(await toCourse(updated, req.user!.id));
    } catch (e: any) {
      logErr(`generation ${kind} ${e?.status ?? ""} ${e?.message}`);
      res.status(502).json({ message: "L'IA n'a pas pu terminer la génération. Ta transcription est intacte : réessaie dans un instant." });
    } finally {
      running.delete(key);
    }
  }));

  // Suppression d'une série : par l'auteur du cours ou par l'auteur de la série.
  app.delete("/api/courses/:id/sets/:sid", auth, h(async (req: AuthedRequest, res) => {
    const row = await viewable(req, res);
    if (!row) return;
    const set = await storage.getSet(row.id, Number(req.params.sid));
    if (!set) return res.json(await toCourse(row, req.user!.id));
    if (row.ownerId !== req.user!.id && set.authorId !== req.user!.id) return res.status(403).json({ message: "Seul l'auteur de la série ou du cours peut la supprimer." });
    await storage.deleteSet(row.id, set.id);
    res.json(await toCourse((await storage.getCourse(row.id))!, req.user!.id));
  }));

  app.post("/api/courses/:id/exam/grade", auth, requireConsent, h(async (req: AuthedRequest, res) => {
    const row = await viewable(req, res);
    if (!row) return;
    const sid = Number(req.body?.setId);
    const set = Number.isFinite(sid) && sid > 0 ? await storage.getSet(row.id, sid) : undefined;
    const exam: Exam | null = set?.kind === "exam" ? (set.data as Exam) : row.exam ?? null;
    if (!exam) return res.status(400).json({ message: "Aucun examen pour ce cours." });
    const answers: Record<string, any> = req.body?.answers || {};
    const all = exam.sections.flatMap((s) => s.questions);
    const per: ExamGrade["per_question"] = [];
    const open: any[] = [];
    for (const q of all) {
      if (q.type === "qcm") {
        const ok = Number(answers[q.id]) === q.answer_index && answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== "";
        per.push({
          id: q.id,
          points_awarded: ok ? q.points : 0,
          max_points: q.points,
          feedback: ok ? "Bonne réponse." : `Réponse attendue : ${q.options?.[q.answer_index ?? 0] ?? q.model_answer}`,
        });
      } else {
        const tbl = (ts?: any[]) => (ts || []).map((t) => `${t.title}\n${[t.headers, ...t.rows].map((r: string[]) => r.join(" | ")).join("\n")}`).join("\n\n");
        open.push({
          id: q.id,
          question: q.tables?.length ? `${q.question}\n\nDonnées :\n${tbl(q.tables)}` : q.question,
          points: q.points,
          model_answer: q.answer_tables?.length ? `${q.model_answer}\n\nTableaux attendus :\n${tbl(q.answer_tables)}` : q.model_answer,
          grading_criteria: q.grading_criteria,
          answer: str(answers[q.id]).slice(0, 12000),
        });
      }
    }
    let overall = "";
    let priorities: string[] = [];
    if (open.length) {
      const allEmpty = open.every((o) => !o.answer.trim());
      if (allEmpty) {
        open.forEach((o) => per.push({ id: o.id, points_awarded: 0, max_points: o.points, feedback: "Aucune réponse rédigée." }));
        overall = "Les questions rédigées n'ont pas été traitées.";
      } else {
        try {
          const g = await gradeOpenAnswers({ title: row.title, subject: row.subject, level: row.level }, open, req.user!.id);
          for (const o of open) {
            const r = arr(g.per_question).find((p: any) => p.id === o.id);
            const pts = Math.max(0, Math.min(o.points, Number(r?.points_awarded) || 0));
            per.push({ id: o.id, points_awarded: pts, max_points: o.points, feedback: str(r?.feedback) || "Pas de commentaire." });
          }
          overall = str(g.overall_feedback);
          priorities = arr(g.priorities).map(str);
        } catch (e: any) {
          logErr(`grade ${e?.status ?? ""} ${e?.message}`);
          return res.status(502).json({ message: "La correction des réponses rédigées a échoué. Tes réponses sont conservées : réessaie." });
        }
      }
    }
    const order = new Map(all.map((q, i) => [q.id, i]));
    per.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const score = Math.round(per.reduce((s, p) => s + p.points_awarded, 0) * 2) / 2;
    const max = per.reduce((s, p) => s + p.max_points, 0);
    res.json({ score, max, per_question: per, overall_feedback: overall, priorities } satisfies ExamGrade);
  }));

  return httpServer;
}
