import type { Course } from "@shared/schema";

/** Modèle de document intermédiaire, partagé par les exports PDF et Word. */
export type Block =
  | { t: "part"; text: string; kicker?: string }
  | { t: "h2"; text: string }
  | { t: "h3"; text: string }
  | { t: "p"; text: string; muted?: boolean }
  | { t: "callout"; label: string; text: string; tone?: "violet" | "rose" | "dark" }
  | { t: "bullets"; items: string[] }
  | { t: "numbered"; items: string[] }
  | { t: "def"; term: string; text: string }
  | { t: "formula"; label: string; expr: string; meaning?: string }
  | { t: "qa"; q: string; a: string }
  | { t: "tags"; items: string[] }
  | { t: "question"; n: number; meta: string; text: string; options?: string[] }
  | { t: "answer"; n: number; text: string; explanation?: string }
  | { t: "table"; title: string; headers: string[]; rows: string[][]; tone?: "violet" | "dark" };

export type ExportPart = "notes" | "sheet" | "class" | "exercises" | "exam";
export const ALL_PARTS: ExportPart[] = ["notes", "sheet", "class", "exercises", "exam"];

const LETTERS = "ABCDEFGH";
const DIFF: Record<string, string> = { facile: "Facile", moyen: "Moyen", difficile: "Difficile" };
const TYPE: Record<string, string> = { qcm: "QCM", vrai_faux: "Vrai ou faux", ouverte: "Question ouverte", application: "Application", cas_pratique: "Cas pratique" };

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const list = (a: unknown): string[] => (Array.isArray(a) ? a.map(clean).filter(Boolean) : []);
const methods = (ms: unknown): Block[] =>
  (Array.isArray(ms) ? ms : []).flatMap((m: any) => [
    { t: "h3" as const, text: clean(m?.title) },
    ...(clean(m?.when) ? [{ t: "p" as const, text: `Quand l'utiliser : ${clean(m.when)}`, muted: true }] : []),
    { t: "numbered" as const, items: list(m?.steps) },
  ]);
const tables = (ts: unknown, tone: "violet" | "dark" = "violet"): Block[] =>
  (Array.isArray(ts) ? ts : [])
    .filter((t: any) => Array.isArray(t?.rows) && t.rows.length)
    .map((t: any) => ({ t: "table" as const, title: clean(t.title), headers: Array.isArray(t.headers) ? t.headers.map(String) : [], rows: t.rows.map((r: any) => (Array.isArray(r) ? r.map(String) : [])), tone }));

export function courseMeta(c: Course) {
  const date = new Date(c.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return [c.subject, c.level, date].filter(Boolean).join(" · ");
}

export function buildBlocks(c: Course, parts: ExportPart[], withAnswers = true): Block[] {
  const out: Block[] = [];
  let partNo = 0;
  const kicker = () => `Partie ${++partNo}`;
  const n = c.notes;
  const s = c.sheet;

  if (parts.includes("notes") && n) {
    out.push({ t: "part", kicker: kicker(), text: "Notes de cours" });
    if (clean(n.central_idea)) out.push({ t: "callout", label: "Idée centrale", text: n.central_idea, tone: "dark" });
    if (list(n.keywords).length) out.push({ t: "tags", items: list(n.keywords) });
    if (clean(n.summary)) {
      out.push({ t: "h2", text: "Résumé" });
      out.push({ t: "p", text: n.summary });
    }
    if (n.plan?.length) {
      out.push({ t: "h2", text: "Le cours, partie par partie" });
      n.plan.forEach((p, i) => {
        out.push({ t: "h3", text: `${String(i + 1).padStart(2, "0")}  ${clean(p.heading).replace(/^\d+\s*[.)\-–:]\s*/, "")}` });
        if (list(p.points).length) out.push({ t: "bullets", items: list(p.points) });
        if (clean(p.explanation)) out.push({ t: "p", text: clean(p.explanation), muted: true });
      });
    }
    if (n.definitions?.length) {
      out.push({ t: "h2", text: "Définitions" });
      n.definitions.forEach((d) => out.push({ t: "def", term: clean(d.term), text: clean(d.definition) }));
    }
    if (n.formulas?.length) {
      out.push({ t: "h2", text: "Formules" });
      n.formulas.forEach((f) => out.push({ t: "formula", label: clean(f.label), expr: clean(f.expression), meaning: clean(f.meaning) }));
    }
    if (n.methods?.length) {
      out.push({ t: "h2", text: "Méthodes" });
      out.push(...methods(n.methods));
    }
    if (n.tables?.length) {
      out.push({ t: "h2", text: "Tableaux du cours" });
      out.push(...tables(n.tables));
    }
    if (n.examples?.length) {
      out.push({ t: "h2", text: "Exemples" });
      n.examples.forEach((e) => out.push({ t: "def", term: clean(e.title), text: clean(e.explanation) }));
    }
    if (n.student_questions?.length) {
      out.push({ t: "h2", text: "Questions posées en cours" });
      n.student_questions.forEach((q) => out.push({ t: "qa", q: clean(q.question), a: clean(q.answer) }));
    }
    if (list(n.to_verify).length) {
      out.push({ t: "callout", label: "À vérifier", text: list(n.to_verify).join("\n"), tone: "rose" });
    }
  }

  if (parts.includes("sheet") && s) {
    out.push({ t: "part", kicker: kicker(), text: "Fiche de révision" });
    if (list(s.essentials).length) {
      out.push({ t: "h2", text: "L'essentiel à savoir" });
      out.push({ t: "numbered", items: list(s.essentials) });
    }
    if (s.formulas?.length) {
      out.push({ t: "h2", text: "Formules et règles à connaître" });
      s.formulas.forEach((f) => out.push({ t: "formula", label: clean(f.label), expr: clean(f.expression), meaning: clean(f.meaning) }));
    }
    if (s.methods?.length) {
      out.push({ t: "h2", text: "Fiches méthode" });
      out.push(...methods(s.methods));
    }
    if (s.tables?.length) {
      out.push({ t: "h2", text: "Tableaux de synthèse" });
      out.push(...tables(s.tables));
    }
    if (s.concept_links?.length) {
      out.push({ t: "h2", text: "Liens entre les notions" });
      s.concept_links.forEach((l) => out.push({ t: "def", term: clean(l.concept), text: list(l.links).join(" · ") }));
    }
    if (list(s.memory_tips).length) {
      out.push({ t: "h2", text: "Astuces de mémorisation" });
      out.push({ t: "bullets", items: list(s.memory_tips) });
    }
    if (list(s.common_mistakes).length) {
      out.push({ t: "callout", label: "Pièges à éviter", text: list(s.common_mistakes).map((m) => `• ${m}`).join("\n"), tone: "rose" });
    }
    if (s.flashcards?.length) {
      out.push({ t: "h2", text: "Cartes mémoire" });
      s.flashcards.forEach((f) => out.push({ t: "qa", q: clean(f.front), a: clean(f.back) }));
    }
    if (list(s.checklist).length) {
      out.push({ t: "h2", text: "Je suis prêt si je sais…" });
      out.push({ t: "bullets", items: list(s.checklist).map((x) => `☐ ${x}`) });
    }
  }

  if (parts.includes("class") && c.classExercises?.items?.length) {
    out.push({ t: "part", kicker: kicker(), text: "Exercices faits en classe" });
    c.classExercises.items.forEach((e) => {
      out.push({ t: "h2", text: `Exercice ${e.number} — ${clean(e.title)}` });
      if (clean(e.reference)) out.push({ t: "p", text: clean(e.reference), muted: true });
      if (clean(e.statement)) out.push({ t: "callout", label: "Énoncé", text: clean(e.statement), tone: "violet" });
      if (!e.statement_complete) out.push({ t: "p", text: "Énoncé incomplet : ajoute la photo de l'énoncé pour le compléter.", muted: true });
      if (withAnswers) {
        if (e.correction?.length) {
          out.push({ t: "h3", text: "Correction donnée en cours" });
          e.correction.forEach((st) => out.push({ t: "def", term: clean(st.step), text: clean(st.detail) }));
        }
        if (clean(e.final_answer)) out.push({ t: "callout", label: "Résultat", text: clean(e.final_answer), tone: "dark" });
      }
      if (list(e.method).length) {
        out.push({ t: "h3", text: "Méthode à retenir" });
        out.push({ t: "numbered", items: list(e.method) });
      }
      if (list(e.pitfalls).length) out.push({ t: "callout", label: "Pièges vus en classe", text: list(e.pitfalls).join("\n"), tone: "rose" });
    });
  }

  if (parts.includes("exercises") && c.exercises?.items?.length) {
    const items = c.exercises.items;
    out.push({ t: "part", kicker: kicker(), text: "Exercices" });
    items.forEach((e, i) => {
      const opts =
        e.type === "qcm" ? list(e.options) : e.type === "vrai_faux" ? ["Vrai", "Faux"] : undefined;
      out.push({ t: "question", n: i + 1, meta: `${TYPE[e.type] || "Exercice"} · ${DIFF[e.difficulty] || ""}`, text: clean(e.question), options: opts });
      out.push(...tables(e.tables));
    });
    if (withAnswers) {
      out.push({ t: "h2", text: "Corrigé des exercices" });
      items.forEach((e, i) => {
        let ans = clean(e.model_answer);
        let expl = clean(e.explanation);
        if (e.type === "qcm" && typeof e.answer_index === "number") {
          ans = `${LETTERS[e.answer_index] ?? ""}. ${list(e.options)[e.answer_index] ?? ""}`;
          if (!expl) expl = clean(e.model_answer);
        }
        if (e.type === "vrai_faux" && typeof e.answer_bool === "boolean") {
          ans = e.answer_bool ? "Vrai" : "Faux";
          if (!expl) expl = clean(e.model_answer);
        }
        out.push({ t: "answer", n: i + 1, text: ans, explanation: expl });
        out.push(...tables(e.answer_tables, "dark"));
      });
    }
  }

  if (parts.includes("exam") && c.exam?.sections?.length) {
    const ex = c.exam;
    const total = ex.sections.flatMap((x) => x.questions).reduce((a, q) => a + (Number(q.points) || 0), 0);
    out.push({ t: "part", kicker: kicker(), text: clean(ex.title) || "Examen blanc" });
    out.push({ t: "callout", label: `Durée : ${ex.duration_minutes || 60} min · Noté sur ${total || 20}`, text: clean(ex.instructions) || "Réponds à toutes les questions.", tone: "violet" });
    let k = 0;
    ex.sections.forEach((sec) => {
      out.push({ t: "h2", text: clean(sec.title) });
      sec.questions.forEach((q) => {
        k++;
        out.push({ t: "question", n: k, meta: `${q.points} pt${q.points > 1 ? "s" : ""}`, text: clean(q.question), options: q.type === "qcm" ? list(q.options) : undefined });
        out.push(...tables(q.tables));
      });
    });
    if (withAnswers) {
      out.push({ t: "h2", text: "Corrigé et barème" });
      k = 0;
      ex.sections.forEach((sec) =>
        sec.questions.forEach((q) => {
          k++;
          let ans = clean(q.model_answer);
          if (q.type === "qcm" && typeof q.answer_index === "number") ans = `${LETTERS[q.answer_index] ?? ""}. ${list(q.options)[q.answer_index] ?? ans}`;
          const crit = list(q.grading_criteria);
          out.push({ t: "answer", n: k, text: ans, explanation: crit.length ? `Barème : ${crit.join(" ; ")}` : undefined });
          out.push(...tables(q.answer_tables, "dark"));
        }),
      );
    }
  }
  return out;
}

export function letter(i: number) {
  return LETTERS[i] ?? String(i + 1);
}

export function safeFileName(title: string) {
  return (
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "cours"
  );
}
