import { users, sessions, courses } from "@shared/schema";
import type { User, CourseRow, Course, CourseSummary } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  has_audio INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  notes TEXT, sheet TEXT, exercises TEXT, exam TEXT
);
`);

export const db = drizzle(sqlite);

function parse<T>(s: string | null): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

export function toCourse(row: CourseRow, viewerId: number): Course {
  const owner = db.select().from(users).where(eq(users.id, row.ownerId)).get();
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName: owner?.name ?? "Utilisateur",
    isOwner: row.ownerId === viewerId,
    title: row.title,
    subject: row.subject,
    level: row.level,
    transcript: row.transcript,
    durationSec: row.durationSec,
    isPublic: !!row.isPublic,
    hasAudio: !!row.hasAudio,
    createdAt: row.createdAt,
    notes: parse(row.notes),
    sheet: parse(row.sheet),
    exercises: parse(row.exercises),
    exam: parse(row.exam),
  };
}

export function toSummary(row: CourseRow, viewerId: number): CourseSummary {
  const c = toCourse(row, viewerId);
  const words = row.transcript.trim() ? row.transcript.trim().split(/\s+/).length : 0;
  const { transcript, notes, sheet, exercises, exam, ...rest } = c;
  return {
    ...rest,
    summary: notes?.summary || notes?.central_idea || transcript.slice(0, 220),
    wordCount: words,
    hasNotes: !!notes,
    hasSheet: !!sheet,
    hasExercises: !!exercises,
    hasExam: !!exam,
  };
}

export const storage = {
  getUserByEmail(email: string): User | undefined {
    return db.select().from(users).where(eq(users.email, email)).get();
  },
  getUser(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  },
  createUser(data: { email: string; name: string; passwordHash: string }): User {
    return db.insert(users).values(data).returning().get();
  },
  createSession(token: string, userId: number) {
    db.insert(sessions).values({ token, userId }).run();
  },
  getSessionUser(token: string): User | undefined {
    const s = db.select().from(sessions).where(eq(sessions.token, token)).get();
    return s ? this.getUser(s.userId) : undefined;
  },
  deleteSession(token: string) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
  },
  listMyCourses(ownerId: number): CourseRow[] {
    return db.select().from(courses).where(eq(courses.ownerId, ownerId)).orderBy(desc(courses.createdAt)).all();
  },
  listPublicCourses(): CourseRow[] {
    return db.select().from(courses).where(eq(courses.isPublic, 1)).orderBy(desc(courses.createdAt)).all();
  },
  getCourse(id: number): CourseRow | undefined {
    return db.select().from(courses).where(eq(courses.id, id)).get();
  },
  createCourse(data: Omit<CourseRow, "id">): CourseRow {
    return db.insert(courses).values(data).returning().get();
  },
  updateCourse(id: number, ownerId: number, patch: Partial<CourseRow>): CourseRow | undefined {
    return db.update(courses).set(patch).where(and(eq(courses.id, id), eq(courses.ownerId, ownerId))).returning().get();
  },
  deleteCourse(id: number, ownerId: number) {
    return db.delete(courses).where(and(eq(courses.id, id), eq(courses.ownerId, ownerId))).run();
  },
};
