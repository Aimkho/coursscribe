import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
});

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: integer("owner_id").notNull(),
  title: text("title").notNull(),
  subject: text("subject").notNull().default(""),
  level: text("level").notNull().default(""),
  transcript: text("transcript").notNull().default(""),
  durationSec: integer("duration_sec").notNull().default(0),
  isPublic: integer("is_public").notNull().default(0),
  hasAudio: integer("has_audio").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  notes: text("notes"),
  sheet: text("sheet"),
  exercises: text("exercises"),
  exam: text("exam"),
});

export type User = typeof users.$inferSelect;
export type CourseRow = typeof courses.$inferSelect;

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
});
export const coursePatchSchema = courseInputSchema.partial().extend({
  isPublic: z.boolean().optional(),
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
  notes: Notes | null;
  sheet: Sheet | null;
  exercises: Exercises | null;
  exam: Exam | null;
};
export type CourseSummary = Omit<Course, "transcript" | "notes" | "sheet" | "exercises" | "exam"> & {
  summary: string;
  wordCount: number;
  hasNotes: boolean;
  hasSheet: boolean;
  hasExercises: boolean;
  hasExam: boolean;
};
export type PublicUser = { id: number; name: string; email: string };
