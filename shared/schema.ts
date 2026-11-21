import { z } from "zod";

// Tables Postgres (Supabase, schéma "coursscribe") — voir server/storage.ts
export type User = { id: number; email: string; name: string; passwordHash: string };
export type CourseStatus = "en_cours" | "termine";
export type CourseRow = {
  id: number;
  ownerId: number;
  ownerName: string;
  subjectId: number | null;
  chapterNumber: number | null;
  title: string;
  subject: string;
  level: string;
  transcript: string;
  durationSec: number;
  isPublic: boolean;
  hasAudio: boolean;
  status: CourseStatus;
  createdAt: number;
  updatedAt: number | null;
  transcriptUpdatedAt: number | null;
  analyzedAt: number | null;
  notes: any;
  sheet: any;
  exercises: any;
  exam: any;
};
export type CourseSession = { id: number; idx: number; startedAt: number; durationSec: number; wordCount: number; hasAudio: boolean };
export type Subject = { id: number; name: string; level: string; createdAt: number; chapterCount: number; lastActivity: number | null };

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Ton nom doit contenir au moins 2 caractères").max(60),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères").max(100),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});
export const courseInputSchema = z.object({
  title: z.string().trim().min(1, "Titre requis").max(140),
  subject: z.string().trim().max(80).default(""),
  level: z.string().trim().max(80).default(""),
  transcript: z.string().max(400000).default(""),
  durationSec: z.number().int().min(0).max(60 * 60 * 12).default(0),
  subjectId: z.number().int().positive().nullable().optional(),
  chapterNumber: z.number().int().min(1).max(999).nullable().optional(),
});
// Pas de .default() ici : un PATCH partiel ne doit jamais écraser les champs absents.
export const coursePatchSchema = z.object({
  title: z.string().trim().min(1, "Titre requis").max(140).optional(),
  subject: z.string().trim().max(80).optional(),
  level: z.string().trim().max(80).optional(),
  transcript: z.string().max(400000).optional(),
  durationSec: z.number().int().min(0).max(60 * 60 * 12).optional(),
  isPublic: z.boolean().optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  chapterNumber: z.number().int().min(1).max(999).nullable().optional(),
  status: z.enum(["en_cours", "termine"]).optional(),
});
export const subjectInputSchema = z.object({
  name: z.string().trim().min(1, "Nom de la matière requis").max(80),
  level: z.string().trim().max(80).default(""),
});

// ---------- Contenus générés par l'IA ----------
export type Notes = {
  title: string;
  central_idea: string;
  summary: string;
  keywords: string[];
  plan: { heading: string; points: string[]; explanation?: string }[];
  definitions: { term: string; definition: string }[];
  examples: { title: string; explanation: string }[];
  formulas: { label: string; expression: string; meaning: string }[];
  student_questions: { question: string; answer: string }[];
  to_verify: string[];
};
export type Sheet = {
  essentials: string[];
  concept_links: { concept: string; links: string[] }[];
  memory_tips: string[];
  common_mistakes: string[];
  flashcards: { front: string; back: string }[];
  checklist: string[];
};
export type Exercise = {
  type: "qcm" | "vrai_faux" | "ouverte" | "application";
  difficulty: "facile" | "moyen" | "difficile";
  question: string;
  options?: string[];
  answer_index?: number;
  answer_bool?: boolean;
  model_answer: string;
  explanation: string;
};
export type Exercises = { items: Exercise[] };
export type ExamQuestion = {
  id: string;
  type: "qcm" | "ouverte";
  question: string;
  options?: string[];
  answer_index?: number;
  points: number;
  model_answer: string;
  grading_criteria: string[];
};
export type Exam = {
  title: string;
  duration_minutes: number;
  instructions: string;
  sections: { title: string; questions: ExamQuestion[] }[];
};
export type ExamGrade = {
  score: number;
  max: number;
  per_question: { id: string; points_awarded: number; max_points: number; feedback: string }[];
  overall_feedback: string;
  priorities: string[];
};

export type Course = {
  id: number;
  ownerId: number;
  ownerName: string;
  isOwner: boolean;
  title: string;
  subject: string;
  level: string;
  transcript: string;
  durationSec: number;
  isPublic: boolean;
  hasAudio: boolean;
  createdAt: number;
  subjectId: number | null;
  chapterNumber: number | null;
  status: CourseStatus;
  updatedAt: number | null;
  /** Le texte a changé depuis la dernière analyse IA. */
  analysisStale: boolean;
  sessions: CourseSession[];
  /** Chapitres voisins dans la même matière (navigation). */
  siblings: { id: number; title: string; chapterNumber: number | null }[];
  notes: Notes | null;
  sheet: Sheet | null;
  exercises: Exercises | null;
  exam: Exam | null;
};
export type CourseSummary = Omit<Course, "transcript" | "notes" | "sheet" | "exercises" | "exam" | "sessions" | "siblings"> & {
  summary: string;
  wordCount: number;
  hasNotes: boolean;
  hasSheet: boolean;
  hasExercises: boolean;
  hasExam: boolean;
  sessionCount: number;
};
export type PublicUser = { id: number; name: string; email: string };
