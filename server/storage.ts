import type { User, CourseRow, Course, CourseSummary, CourseSession, Subject } from "@shared/schema";
import { q, one, pool } from "./db";

const COURSE_COLS = `
  c.id, c.owner_id as "ownerId", u.name as "ownerName", c.subject_id as "subjectId", c.chapter_number as "chapterNumber",
  c.title, coalesce(s.name, c.subject) as subject, c.level, c.transcript, c.duration_sec as "durationSec",
  c.is_public as "isPublic", c.has_audio as "hasAudio", c.status, c.created_at as "createdAt", c.updated_at as "updatedAt",
  c.transcript_updated_at as "transcriptUpdatedAt", c.analyzed_at as "analyzedAt",
  c.notes, c.sheet, c.exercises, c.exam`;
const COURSE_FROM = `from public.courses c
  join public.users u on u.id = c.owner_id
  left join public.subjects s on s.id = c.subject_id`;
// Ordre : matière, puis numéro de chapitre, puis date
const COURSE_ORDER = `order by coalesce(c.updated_at, c.created_at) desc`;

function stale(row: CourseRow) {
  return !!row.notes && !!row.transcriptUpdatedAt && (!row.analyzedAt || row.transcriptUpdatedAt > row.analyzedAt);
}

function base(row: CourseRow, viewerId: number) {
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName: row.ownerName ?? "Utilisateur",
    isOwner: row.ownerId === viewerId,
    title: row.title,
    subject: row.subject,
    level: row.level,
    durationSec: row.durationSec,
    isPublic: !!row.isPublic,
    hasAudio: !!row.hasAudio,
    createdAt: row.createdAt,
    subjectId: row.subjectId,
    chapterNumber: row.chapterNumber,
    status: row.status,
    updatedAt: row.updatedAt,
    analysisStale: stale(row),
  };
}

export async function toCourse(row: CourseRow, viewerId: number): Promise<Course> {
  const [sessions, siblings] = await Promise.all([
    storage.listCourseSessions(row.id),
    row.subjectId
      ? q(
          `select id, title, chapter_number as "chapterNumber" from public.courses
           where subject_id = $1 and (owner_id = $2 or is_public) order by chapter_number nulls last, created_at`,
          [row.subjectId, viewerId],
        )
      : Promise.resolve([]),
  ]);
  return {
    ...base(row, viewerId),
    transcript: row.transcript,
    sessions,
    siblings,
    notes: row.notes ?? null,
    sheet: row.sheet ?? null,
    exercises: row.exercises ?? null,
    exam: row.exam ?? null,
  };
}

export function toSummary(row: CourseRow & { sessionCount?: number }, viewerId: number): CourseSummary {
  const words = row.transcript.trim() ? row.transcript.trim().split(/\s+/).length : 0;
  return {
    ...base(row, viewerId),
    summary: row.notes?.summary || row.notes?.central_idea || row.transcript.replace(/^—.*—$/gm, "").trim().slice(0, 220),
    wordCount: words,
    hasNotes: !!row.notes,
    hasSheet: !!row.sheet,
    hasExercises: !!row.exercises,
    hasExam: !!row.exam,
    sessionCount: Number(row.sessionCount ?? 0) || 1,
  };
}

const PATCH_COLS: Record<string, string> = {
  title: "title",
  subject: "subject",
  level: "level",
  transcript: "transcript",
  durationSec: "duration_sec",
  isPublic: "is_public",
  hasAudio: "has_audio",
  subjectId: "subject_id",
  chapterNumber: "chapter_number",
  status: "status",
  notes: "notes",
  sheet: "sheet",
  exercises: "exercises",
  exam: "exam",
  analyzedAt: "analyzed_at",
  transcriptUpdatedAt: "transcript_updated_at",
};
const JSON_COLS = new Set(["notes", "sheet", "exercises", "exam"]);

export const storage = {
  async getUserByEmail(email: string): Promise<User | undefined> {
    return one(`select id, email, name, password_hash as "passwordHash" from public.users where email = $1`, [email]);
  },
  async getUser(id: number): Promise<User | undefined> {
    return one(`select id, email, name, password_hash as "passwordHash" from public.users where id = $1`, [id]);
  },
  async createUser(data: { email: string; name: string; passwordHash: string }): Promise<User> {
    return (await one(
      `insert into public.users (email, name, password_hash) values ($1, $2, $3)
       returning id, email, name, password_hash as "passwordHash"`,
      [data.email, data.name, data.passwordHash],
    ))!;
  },
  async createSession(token: string, userId: number) {
    await q(`insert into public.sessions (token, user_id) values ($1, $2)`, [token, userId]);
  },
  async getSessionUser(token: string): Promise<User | undefined> {
    return one(
      `select u.id, u.email, u.name, u.password_hash as "passwordHash"
       from public.sessions s join public.users u on u.id = s.user_id where s.token = $1`,
      [token],
    );
  },
  async deleteSession(token: string) {
    await q(`delete from public.sessions where token = $1`, [token]);
  },

  // ---------- Matières ----------
  async listSubjects(ownerId: number): Promise<Subject[]> {
    return q(
      `select s.id, s.name, s.level, s.created_at as "createdAt",
              count(c.id)::int as "chapterCount",
              max(coalesce(c.updated_at, c.created_at)) as "lastActivity"
       from public.subjects s left join public.courses c on c.subject_id = s.id
       where s.owner_id = $1 group by s.id order by max(coalesce(c.updated_at, c.created_at)) desc nulls last, s.name`,
      [ownerId],
    );
  },
  async getSubject(id: number, ownerId: number) {
    return one<{ id: number; name: string; level: string }>(
      `select id, name, level from public.subjects where id = $1 and owner_id = $2`,
      [id, ownerId],
    );
  },
  async findOrCreateSubject(ownerId: number, name: string, level = "") {
    const clean = name.trim();
    const found = await one<{ id: number; name: string; level: string }>(
      `select id, name, level from public.subjects where owner_id = $1 and lower(name) = lower($2)`,
      [ownerId, clean],
    );
    if (found) {
      if (level && !found.level) await q(`update public.subjects set level = $1 where id = $2`, [level, found.id]);
      return found;
    }
    return (await one<{ id: number; name: string; level: string }>(
      `insert into public.subjects (owner_id, name, level, created_at) values ($1, $2, $3, $4)
       on conflict (owner_id, lower(name)) do update set name = excluded.name returning id, name, level`,
      [ownerId, clean, level, Date.now()],
    ))!;
  },
  async renameSubject(id: number, ownerId: number, name: string, level?: string) {
    const r = await one(
      `update public.subjects set name = $3, level = coalesce($4, level) where id = $1 and owner_id = $2 returning id`,
      [id, ownerId, name.trim(), level ?? null],
    );
    if (r) await q(`update public.courses set subject = $2 where subject_id = $1`, [id, name.trim()]);
    return r;
  },
  async deleteSubject(id: number, ownerId: number) {
    // Les chapitres sont conservés (subject_id passe à null, le nom reste en texte).
    const r = await q(`delete from public.subjects where id = $1 and owner_id = $2 returning id`, [id, ownerId]);
    return r.length > 0;
  },
  async nextChapterNumber(subjectId: number) {
    const r = await one<{ n: number }>(
      `select coalesce(max(chapter_number), 0)::int + 1 as n from public.courses where subject_id = $1`,
      [subjectId],
    );
    return r?.n ?? 1;
  },

  // ---------- Cours ----------
  async listMyCourses(ownerId: number) {
    return q<CourseRow & { sessionCount: number }>(
      `select ${COURSE_COLS}, (select count(*)::int from public.course_sessions cs where cs.course_id = c.id) as "sessionCount"
       ${COURSE_FROM} where c.owner_id = $1 ${COURSE_ORDER}`,
      [ownerId],
    );
  },
  async listPublicCourses() {
    return q<CourseRow & { sessionCount: number }>(
      `select ${COURSE_COLS}, (select count(*)::int from public.course_sessions cs where cs.course_id = c.id) as "sessionCount"
       ${COURSE_FROM} where c.is_public ${COURSE_ORDER} limit 300`,
    );
  },
  async getCourse(id: number): Promise<CourseRow | undefined> {
    if (!Number.isFinite(id)) return undefined;
    return one(`select ${COURSE_COLS} ${COURSE_FROM} where c.id = $1`, [id]);
  },
  async createCourse(data: {
    ownerId: number;
    title: string;
    subject: string;
    level: string;
    transcript: string;
    durationSec: number;
    subjectId: number | null;
    chapterNumber: number | null;
  }): Promise<CourseRow> {
    const now = Date.now();
    const r = await one<{ id: number }>(
      `insert into public.courses (owner_id, title, subject, level, transcript, duration_sec, subject_id, chapter_number, created_at, updated_at, transcript_updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9) returning id`,
      [data.ownerId, data.title, data.subject, data.level, data.transcript, data.durationSec, data.subjectId, data.chapterNumber, now],
    );
    return (await this.getCourse(r!.id))!;
  },
  async updateCourse(id: number, ownerId: number, patch: Record<string, any>): Promise<CourseRow | undefined> {
    const sets: string[] = [];
    const vals: any[] = [id, ownerId];
    for (const [k, v] of Object.entries(patch)) {
      const col = PATCH_COLS[k];
      if (!col || v === undefined) continue;
      vals.push(JSON_COLS.has(k) && v !== null && typeof v !== "string" ? JSON.stringify(v) : v);
      sets.push(`${col} = $${vals.length}`);
    }
    if ("transcript" in patch && !("transcriptUpdatedAt" in patch)) {
      vals.push(Date.now());
      sets.push(`transcript_updated_at = $${vals.length}`);
    }
    vals.push(Date.now());
    sets.push(`updated_at = $${vals.length}`);
    const r = await one<{ id: number }>(
      `update public.courses set ${sets.join(", ")} where id = $1 and owner_id = $2 returning id`,
      vals,
    );
    return r ? this.getCourse(r.id) : undefined;
  },
  async deleteCourse(id: number, ownerId: number) {
    const r = await q(`delete from public.courses where id = $1 and owner_id = $2 returning id`, [id, ownerId]);
    return r.length > 0;
  },

  // ---------- Séances ----------
  async listCourseSessions(courseId: number): Promise<CourseSession[]> {
    return q(
      `select id, idx, started_at as "startedAt", duration_sec as "durationSec", word_count as "wordCount", has_audio as "hasAudio"
       from public.course_sessions where course_id = $1 order by idx`,
      [courseId],
    );
  },
  async createCourseSession(courseId: number, startedAt: number): Promise<CourseSession> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock($1)`, [courseId]);
      const r = await client.query(
        `insert into public.course_sessions (course_id, idx, started_at)
         values ($1, (select coalesce(max(idx), 0) + 1 from public.course_sessions where course_id = $1), $2)
         returning id, idx, started_at as "startedAt", duration_sec as "durationSec", word_count as "wordCount", has_audio as "hasAudio"`,
        [courseId, startedAt],
      );
      await client.query("commit");
      return r.rows[0];
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },
  async updateCourseSession(courseId: number, sessionId: number, patch: { durationSec?: number; wordCount?: number; hasAudio?: boolean }) {
    return one<CourseSession>(
      `update public.course_sessions set
         duration_sec = coalesce($3, duration_sec), word_count = coalesce($4, word_count), has_audio = coalesce($5, has_audio)
       where id = $2 and course_id = $1
       returning id, idx, started_at as "startedAt", duration_sec as "durationSec", word_count as "wordCount", has_audio as "hasAudio"`,
      [courseId, sessionId, patch.durationSec ?? null, patch.wordCount ?? null, patch.hasAudio ?? null],
    );
  },
  async getCourseSession(courseId: number, sessionId: number) {
    return one<CourseSession>(
      `select id, idx, started_at as "startedAt", duration_sec as "durationSec", word_count as "wordCount", has_audio as "hasAudio"
       from public.course_sessions where id = $2 and course_id = $1`,
      [courseId, sessionId],
    );
  },
  async recomputeDuration(courseId: number) {
    await q(
      `update public.courses set duration_sec = (select coalesce(sum(duration_sec),0) from public.course_sessions where course_id = $1) where id = $1`,
      [courseId],
    );
  },
};
