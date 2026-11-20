import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import type { Server } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { storage, toCourse, toSummary } from "./storage";
import { registerSchema, loginSchema, courseInputSchema, coursePatchSchema } from "@shared/schema";
import type { User, Exam, ExamGrade } from "@shared/schema";
import { generateNotes, generateSheet, generateExercises, generateExam, gradeOpenAnswers } from "./ai";

const UPLOAD_DIR = path.resolve("uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token as string) || "";
  const user = token ? storage.getSessionUser(token) : undefined;
  if (!user) return res.status(401).json({ message: "Session expirée. Reconnecte-toi." });
  req.user = user;
  req.token = token;
  next();
}

function publicUser(u: User) {
  return { id: u.id, name: u.name, email: u.email };
}

function zodMessage(err: any) {
  return err?.issues?.[0]?.message || "Données invalides";
}

const arr = (v: any) => (Array.isArray(v) ? v : []);
const str = (v: any) => (typeof v === "string" ? v : v == null ? "" : String(v));

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
  };
}
const TYPES = ["qcm", "vrai_faux", "ouverte", "application"];
const DIFFS = ["facile", "moyen", "difficile"];
function normalizeExercises(e: any) {
  return {
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
      }))
      .filter((i: any) => i.question && (i.type !== "qcm" || (i.options?.length >= 2 && i.answer_index !== undefined))),
  };
}
function normalizeExam(x: any): Exam {
  let n = 0;
  return {
    title: str(x.title) || "Examen blanc",
    duration_minutes: Number(x.duration_minutes) > 0 ? Math.min(240, Number(x.duration_minutes)) : 45,
    instructions: str(x.instructions),
    sections: arr(x.sections).map((s: any) => ({
      title: str(s.title),
      questions: arr(s.questions)
        .map((q: any) => ({
          id: `q${++n}`,
          type: q.type === "qcm" ? "qcm" : "ouverte",
          question: str(q.question),
          options: q.type === "qcm" ? arr(q.options).map(str) : undefined,
          answer_index: typeof q.answer_index === "number" ? q.answer_index : undefined,
          points: Number(q.points) > 0 ? Number(q.points) : 1,
          model_answer: str(q.model_answer),
          grading_criteria: arr(q.grading_criteria).map(str),
        }))
        .filter((q: any) => q.question),
    })),
  } as Exam;
}

const running = new Set<string>();

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ---------- Auth ----------
  app.post("/api/auth/register", (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const { name, email, password } = parsed.data;
    if (storage.getUserByEmail(email)) return res.status(409).json({ message: "Un compte existe déjà avec cette adresse e-mail." });
    const user = storage.createUser({ name, email, passwordHash: hashPassword(password) });
    const token = randomBytes(32).toString("hex");
    storage.createSession(token, user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post("/api/auth/login", (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const user = storage.getUserByEmail(parsed.data.email);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash))
      return res.status(401).json({ message: "E-mail ou mot de passe incorrect." });
    const token = randomBytes(32).toString("hex");
    storage.createSession(token, user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post("/api/auth/logout", auth, (req: AuthedRequest, res) => {
    storage.deleteSession(req.token!);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", auth, (req: AuthedRequest, res) => res.json(publicUser(req.user!)));

  // ---------- Cours ----------
  app.get("/api/courses", auth, (req: AuthedRequest, res) => {
    res.json(storage.listMyCourses(req.user!.id).map((c) => toSummary(c, req.user!.id)));
  });

  app.get("/api/library", auth, (req: AuthedRequest, res) => {
    res.json(storage.listPublicCourses().map((c) => toSummary(c, req.user!.id)));
  });

  app.post("/api/courses", auth, (req: AuthedRequest, res) => {
    const parsed = courseInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const row = storage.createCourse({
      ...parsed.data,
      ownerId: req.user!.id,
      isPublic: 0,
      hasAudio: 0,
      createdAt: Date.now(),
      notes: null,
      sheet: null,
      exercises: null,
      exam: null,
    });
    res.json(toCourse(row, req.user!.id));
  });

  function viewable(req: AuthedRequest, res: Response) {
    const row = storage.getCourse(Number(req.params.id));
    if (!row || (row.ownerId !== req.user!.id && !row.isPublic)) {
      res.status(404).json({ message: "Cours introuvable ou privé." });
      return undefined;
    }
    return row;
  }

  app.get("/api/courses/:id", auth, (req: AuthedRequest, res) => {
    const row = viewable(req, res);
    if (row) res.json(toCourse(row, req.user!.id));
  });

  app.patch("/api/courses/:id", auth, (req: AuthedRequest, res) => {
    const parsed = coursePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: zodMessage(parsed.error) });
    const { isPublic, ...rest } = parsed.data;
    const patch: any = { ...rest };
    if (isPublic !== undefined) patch.isPublic = isPublic ? 1 : 0;
    const row = storage.updateCourse(Number(req.params.id), req.user!.id, patch);
    if (!row) return res.status(404).json({ message: "Cours introuvable." });
    res.json(toCourse(row, req.user!.id));
  });

  app.delete("/api/courses/:id", auth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const r = storage.deleteCourse(id, req.user!.id);
    if (!r.changes) return res.status(404).json({ message: "Cours introuvable." });
    fs.rmSync(path.join(UPLOAD_DIR, `${id}.webm`), { force: true });
    res.json({ ok: true });
  });

  // ---------- Audio ----------
  app.post(
    "/api/courses/:id/audio",
    auth,
    express.raw({ type: () => true, limit: "300mb" }),
    (req: AuthedRequest, res) => {
      const row = storage.getCourse(Number(req.params.id));
      if (!row || row.ownerId !== req.user!.id) return res.status(404).json({ message: "Cours introuvable." });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "Fichier audio vide." });
      fs.writeFileSync(path.join(UPLOAD_DIR, `${row.id}.webm`), req.body);
      storage.updateCourse(row.id, req.user!.id, { hasAudio: 1 });
      res.json({ ok: true, bytes: req.body.length });
    },
  );

  app.get("/api/courses/:id/audio", auth, (req: AuthedRequest, res) => {
    const row = storage.getCourse(Number(req.params.id));
    if (!row || row.ownerId !== req.user!.id) return res.status(404).end();
    const file = path.join(UPLOAD_DIR, `${row.id}.webm`);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.setHeader("Content-Type", "audio/webm");
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="cours-${row.id}.webm"`);
    fs.createReadStream(file).pipe(res);
  });

  // ---------- Génération IA ----------
  app.post("/api/courses/:id/generate/:kind", auth, async (req: AuthedRequest, res) => {
    const kind = String(req.params.kind);
    if (!["notes", "sheet", "exercises", "exam"].includes(kind)) return res.status(400).json({ message: "Type inconnu." });
    const row = storage.getCourse(Number(req.params.id));
    if (!row || row.ownerId !== req.user!.id) return res.status(404).json({ message: "Cours introuvable." });
    const words = row.transcript.trim().split(/\s+/).filter(Boolean).length;
    if (words < 40)
      return res.status(400).json({ message: `La transcription est trop courte (${words} mots). Il faut au moins 40 mots pour une analyse fiable.` });
    const key = `${row.id}:${kind}`;
    if (running.has(key)) return res.status(409).json({ message: "Une génération est déjà en cours pour ce contenu." });
    running.add(key);
    const meta = { title: row.title, subject: row.subject, level: row.level };
    try {
      let notes = row.notes ? JSON.parse(row.notes) : null;
      const patch: any = {};
      if (kind === "notes" || !notes) {
        notes = normalizeNotes(await generateNotes(meta, row.transcript));
        patch.notes = JSON.stringify(notes);
      }
      if (kind === "sheet") patch.sheet = JSON.stringify(normalizeSheet(await generateSheet(meta, row.transcript, notes)));
      if (kind === "exercises") patch.exercises = JSON.stringify(normalizeExercises(await generateExercises(meta, row.transcript, notes)));
      if (kind === "exam") patch.exam = JSON.stringify(normalizeExam(await generateExam(meta, row.transcript, notes)));
      const updated = storage.updateCourse(row.id, req.user!.id, patch)!;
      res.json(toCourse(updated, req.user!.id));
    } catch (e: any) {
      console.error("generation error", e?.message); fs.appendFileSync("gen-errors.log", `${new Date().toISOString()} ${kind} ${e?.status ?? ""} ${e?.message}\n`);
      res.status(502).json({ message: "L'IA n'a pas pu terminer la génération. Ta transcription est intacte : réessaie dans un instant." });
    } finally {
      running.delete(key);
    }
  });

  app.post("/api/courses/:id/exam/grade", auth, async (req: AuthedRequest, res) => {
    const row = viewable(req, res);
    if (!row) return;
    const exam: Exam | null = row.exam ? JSON.parse(row.exam) : null;
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
        open.push({ id: q.id, question: q.question, points: q.points, model_answer: q.model_answer, grading_criteria: q.grading_criteria, answer: str(answers[q.id]).slice(0, 8000) });
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
          const g = await gradeOpenAnswers({ title: row.title, subject: row.subject, level: row.level }, open);
          for (const o of open) {
            const r = arr(g.per_question).find((p: any) => p.id === o.id);
            const pts = Math.max(0, Math.min(o.points, Number(r?.points_awarded) || 0));
            per.push({ id: o.id, points_awarded: pts, max_points: o.points, feedback: str(r?.feedback) || "Pas de commentaire." });
          }
          overall = str(g.overall_feedback);
          priorities = arr(g.priorities).map(str);
        } catch (e: any) {
          fs.appendFileSync("gen-errors.log", `${new Date().toISOString()} grade ${e?.status ?? ""} ${e?.message}\n`);
          return res.status(502).json({ message: "La correction des réponses rédigées a échoué. Tes réponses sont conservées : réessaie." });
        }
      }
    }
    const order = new Map(all.map((q, i) => [q.id, i]));
    per.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const score = Math.round(per.reduce((s, p) => s + p.points_awarded, 0) * 2) / 2;
    const max = per.reduce((s, p) => s + p.max_points, 0);
    res.json({ score, max, per_question: per, overall_feedback: overall, priorities } satisfies ExamGrade);
  });

  return httpServer;
}
