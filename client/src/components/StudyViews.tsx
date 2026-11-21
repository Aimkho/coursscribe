import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Lightbulb,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Shuffle,
  Sigma,
  Target,
  Trophy,
  X,
  XCircle,
  BookMarked,
  Link2,
  ListChecks,
} from "lucide-react";
import type { Notes, Sheet, Exercises, Exercise, Exam, ExamGrade } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

function SectionTitle({ icon: Icon, children, tone = "violet" }: { icon: any; children: React.ReactNode; tone?: "violet" | "pink" | "wine" }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <span
        className={cn(
          "grid h-7 w-7 place-items-center rounded-lg",
          tone === "violet" && "bg-secondary text-primary",
          tone === "pink" && "bg-[#FE277E]/10 text-[#C3155D]",
          tone === "wine" && "bg-[#8A0D1E]/10 text-[#8A0D1E]",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      {children}
    </h3>
  );
}

const panel = "rounded-2xl border border-card-border bg-card p-5 sm:p-6";

// ---------------- NOTES ----------------
export function NotesView({ notes }: { notes: Notes }) {
  return (
    <div className="space-y-5" data-testid="view-notes">
      <div className="rounded-2xl bg-[#1A1033] p-6 text-white sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#C49FFF]">Idée centrale</p>
        <p className="mt-2 font-display text-lg font-bold leading-snug sm:text-xl">{notes.central_idea}</p>
        {notes.keywords.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {notes.keywords.map((k) => (
              <span key={k} className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90">
                {k}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={panel}>
        <SectionTitle icon={BookMarked}>Résumé</SectionTitle>
        <p className="text-[15px] leading-7 text-foreground/90">{notes.summary}</p>
      </div>

      {notes.plan.length > 0 && (
        <div className={panel}>
          <SectionTitle icon={ListChecks}>Le cours, partie par partie</SectionTitle>
          <ol className="space-y-6">
            {notes.plan.map((p, i) => (
              <li key={i} className="grid gap-3 sm:grid-cols-[40px_minmax(0,1fr)]">
                <span className="font-display text-2xl font-extrabold leading-none text-[#C49FFF]">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <h4 className="text-base font-semibold">{p.heading}</h4>
                  <ul className="mt-2 space-y-1.5">
                    {p.points.map((pt, j) => (
                      <li key={j} className="flex gap-2.5 text-[15px] leading-6">
                        <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="break-anywhere">{pt}</span>
                      </li>
                    ))}
                  </ul>
                  {p.explanation && (
                    <p className="mt-3 rounded-lg border-l-2 border-primary bg-secondary/50 px-4 py-3 text-sm leading-6 text-foreground/85">{p.explanation}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {notes.definitions.length > 0 && (
          <div className={panel}>
            <SectionTitle icon={BookMarked}>Définitions</SectionTitle>
            <dl className="divide-y divide-border">
              {notes.definitions.map((d, i) => (
                <div key={i} className="py-3 first:pt-0 last:pb-0">
                  <dt className="text-sm font-semibold text-primary">{d.term}</dt>
                  <dd className="mt-0.5 text-sm leading-6">{d.definition}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {notes.formulas.length > 0 && (
          <div className={panel}>
            <SectionTitle icon={Sigma} tone="pink">Formules</SectionTitle>
            <div className="space-y-3">
              {notes.formulas.map((f, i) => (
                <div key={i} className="rounded-xl border border-border bg-background p-3.5">
                  <p className="text-xs font-medium text-muted-foreground">{f.label}</p>
                  <p className="mt-1 break-anywhere font-mono text-sm font-semibold">{f.expression}</p>
                  {f.meaning && <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{f.meaning}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {notes.examples.length > 0 && (
        <div className={panel}>
          <SectionTitle icon={Lightbulb}>Exemples du cours</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {notes.examples.map((e, i) => (
              <div key={i} className="rounded-xl bg-muted/60 p-4">
                <p className="text-sm font-semibold">{e.title}</p>
                <p className="mt-1 text-sm leading-6 text-foreground/85">{e.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {notes.student_questions.length > 0 && (
        <div className={panel}>
          <SectionTitle icon={MessageCircleQuestion} tone="pink">Questions posées en cours</SectionTitle>
          <div className="space-y-3">
            {notes.student_questions.map((q, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold">« {q.question} »</p>
                <p className="mt-1.5 text-sm leading-6 text-foreground/85">{q.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {notes.to_verify.length > 0 && (
        <div className="rounded-2xl border border-[#8A0D1E]/20 bg-[#8A0D1E]/[0.04] p-5">
          <SectionTitle icon={AlertTriangle} tone="wine">À vérifier dans ton support</SectionTitle>
          <ul className="space-y-1.5">
            {notes.to_verify.map((t, i) => (
              <li key={i} className="text-sm leading-6 text-foreground/85">
                • {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------- FICHE ----------------
function Flashcards({ cards }: { cards: Sheet["flashcards"] }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const card = cards[order[idx]];
  if (!card) return null;
  const go = (d: number) => {
    setFlipped(false);
    setIdx((i) => (i + d + order.length) % order.length);
  };
  return (
    <div className={panel}>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle icon={Brain}>Flashcards</SectionTitle>
        <span className="text-xs tabular-nums text-muted-foreground" data-testid="text-flash-progress">
          {idx + 1} / {cards.length} · {known.size} sue{known.size > 1 ? "s" : ""}
        </span>
      </div>
      <button
        onClick={() => setFlipped((f) => !f)}
        className={cn("flip-card block w-full text-left", flipped && "is-flipped")}
        data-testid="button-flashcard"
        aria-label="Retourner la carte"
      >
        <div className="flip-inner min-h-[180px]">
          <div className="flip-face flex min-h-[180px] flex-col justify-center rounded-xl border-2 border-primary/20 bg-secondary/40 p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Question</p>
            <p className="mt-2 text-lg font-semibold leading-snug">{card.front}</p>
            <p className="mt-4 text-xs text-muted-foreground">Clique pour voir la réponse</p>
          </div>
          <div className="flip-face flip-back flex flex-col justify-center rounded-xl bg-primary p-6 text-primary-foreground">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Réponse</p>
            <p className="mt-2 text-base leading-relaxed">{card.back}</p>
          </div>
        </div>
      </button>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => go(-1)} aria-label="Précédente" data-testid="button-flash-prev">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => go(1)} aria-label="Suivante" data-testid="button-flash-next">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Mélanger"
            onClick={() => {
              setOrder((o) => [...o].sort(() => Math.random() - 0.5));
              setIdx(0);
              setFlipped(false);
            }}
            data-testid="button-flash-shuffle"
          >
            <Shuffle className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setKnown((k) => {
                const n = new Set(k);
                n.delete(order[idx]);
                return n;
              });
              go(1);
            }}
            data-testid="button-flash-review"
          >
            À revoir
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setKnown((k) => new Set(k).add(order[idx]));
              go(1);
            }}
            data-testid="button-flash-known"
          >
            <Check className="mr-1 h-4 w-4" /> Je sais
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SheetView({ sheet }: { sheet: Sheet }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  return (
    <div className="space-y-5" data-testid="view-sheet">
      <div className={panel}>
        <SectionTitle icon={Target}>L'essentiel à savoir</SectionTitle>
        <ol className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {sheet.essentials.map((e, i) => (
            <li key={i} className="flex gap-3 text-[15px] leading-6">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
              <span className="min-w-0 break-anywhere">{e}</span>
            </li>
          ))}
        </ol>
      </div>

      {sheet.flashcards.length > 0 && <Flashcards cards={sheet.flashcards} />}

      <div className="grid gap-5 lg:grid-cols-2">
        {sheet.common_mistakes.length > 0 && (
          <div className="rounded-2xl border border-[#8A0D1E]/20 bg-card p-5 sm:p-6">
            <SectionTitle icon={XCircle} tone="wine">Erreurs à éviter</SectionTitle>
            <ul className="space-y-2.5">
              {sheet.common_mistakes.map((m, i) => (
                <li key={i} className="border-l-2 border-[#8A0D1E] pl-3 text-sm leading-6">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sheet.memory_tips.length > 0 && (
          <div className={panel}>
            <SectionTitle icon={Lightbulb} tone="pink">Astuces de mémorisation</SectionTitle>
            <ul className="space-y-2.5">
              {sheet.memory_tips.map((m, i) => (
                <li key={i} className="border-l-2 border-[#FE277E] pl-3 text-sm leading-6">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {sheet.concept_links.length > 0 && (
        <div className={panel}>
          <SectionTitle icon={Link2}>Liens entre les notions</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {sheet.concept_links.map((c, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold text-primary">{c.concept}</p>
                <ul className="mt-1.5 space-y-1">
                  {c.links.map((l, j) => (
                    <li key={j} className="flex gap-2 text-sm leading-6">
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-[#C49FFF]" />
                      <span className="min-w-0">{l}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {sheet.checklist.length > 0 && (
        <div className={panel}>
          <div className="flex items-center justify-between">
            <SectionTitle icon={CheckCircle2}>Prêt pour l'examen ?</SectionTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              {checked.size}/{sheet.checklist.length}
            </span>
          </div>
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(checked.size / sheet.checklist.length) * 100}%` }} />
          </div>
          <ul className="space-y-1">
            {sheet.checklist.map((c, i) => (
              <li key={i}>
                <label className="flex cursor-pointer gap-3 rounded-lg px-2 py-2 text-sm leading-6 hover:bg-muted/60">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[#7D4FFE]"
                    checked={checked.has(i)}
                    onChange={() =>
                      setChecked((s) => {
                        const n = new Set(s);
                        n.has(i) ? n.delete(i) : n.add(i);
                        return n;
                      })
                    }
                    data-testid={`checkbox-checklist-${i}`}
                  />
                  <span className={cn(checked.has(i) && "text-muted-foreground line-through")}>{c}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------- EXERCICES ----------------
const TYPE_LABEL: Record<Exercise["type"], string> = {
  qcm: "QCM",
  vrai_faux: "Vrai ou faux",
  ouverte: "Question ouverte",
  application: "Application",
};
const DIFF_STYLE: Record<Exercise["difficulty"], string> = {
  facile: "bg-secondary text-secondary-foreground",
  moyen: "bg-[#FE277E]/10 text-[#C3155D]",
  difficile: "bg-[#8A0D1E]/10 text-[#8A0D1E]",
};

function ExerciseCard({ ex, n, onResult }: { ex: Exercise; n: number; onResult: (ok: boolean | null) => void }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [bool, setBool] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const auto = ex.type === "qcm" || ex.type === "vrai_faux";
  const correct = ex.type === "qcm" ? choice === ex.answer_index : ex.type === "vrai_faux" ? bool === ex.answer_bool : null;

  function check() {
    setRevealed(true);
    onResult(auto ? correct : null);
  }
  function reset() {
    setChoice(null);
    setBool(null);
    setText("");
    setRevealed(false);
    onResult(undefined as any);
  }

  return (
    <article className={panel} data-testid={`card-exercise-${n}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-display text-sm font-extrabold text-[#C49FFF]">#{String(n).padStart(2, "0")}</span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{TYPE_LABEL[ex.type]}</span>
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium capitalize", DIFF_STYLE[ex.difficulty])}>{ex.difficulty}</span>
        {revealed && auto && (
          <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-semibold", correct ? "text-primary" : "text-[#8A0D1E]")}>
            {correct ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {correct ? "Bonne réponse" : "Incorrect"}
          </span>
        )}
      </div>
      <p className="whitespace-pre-line text-[15px] font-medium leading-7">{ex.question}</p>

      {ex.type === "qcm" && (
        <div className="mt-4 grid gap-2">
          {ex.options?.map((o, i) => {
            const isAnswer = i === ex.answer_index;
            return (
              <button
                key={i}
                disabled={revealed}
                onClick={() => setChoice(i)}
                data-testid={`option-${n}-${i}`}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm leading-6 transition-colors",
                  !revealed && choice === i && "border-primary bg-secondary/60",
                  !revealed && choice !== i && "border-border hover:border-primary/40",
                  revealed && isAnswer && "border-primary bg-secondary",
                  revealed && !isAnswer && choice === i && "border-[#8A0D1E]/50 bg-[#8A0D1E]/5",
                  revealed && !isAnswer && choice !== i && "border-border opacity-60",
                )}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-current/20 text-xs font-bold">{String.fromCharCode(65 + i)}</span>
                <span className="min-w-0">{o}</span>
              </button>
            );
          })}
        </div>
      )}

      {ex.type === "vrai_faux" && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              disabled={revealed}
              onClick={() => setBool(v)}
              data-testid={`option-${n}-${v ? "vrai" : "faux"}`}
              className={cn(
                "rounded-xl border px-4 py-3 text-sm font-semibold transition-colors",
                !revealed && bool === v && "border-primary bg-secondary/60",
                !revealed && bool !== v && "border-border hover:border-primary/40",
                revealed && v === ex.answer_bool && "border-primary bg-secondary",
                revealed && v !== ex.answer_bool && bool === v && "border-[#8A0D1E]/50 bg-[#8A0D1E]/5",
                revealed && v !== ex.answer_bool && bool !== v && "border-border opacity-60",
              )}
            >
              {v ? "Vrai" : "Faux"}
            </button>
          ))}
        </div>
      )}

      {!auto && (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Rédige ta réponse avant de regarder le corrigé…"
          className="mt-4 min-h-[110px] text-sm leading-6"
          disabled={revealed}
          data-testid={`textarea-exercise-${n}`}
        />
      )}

      {revealed && (
        <div className="mt-4 rounded-xl bg-muted/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Corrigé</p>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-6">{ex.model_answer}</p>
          {ex.explanation && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">{ex.explanation}</p>}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {revealed ? (
          <Button variant="ghost" size="sm" onClick={reset} data-testid={`button-retry-${n}`}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Recommencer
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={check}
            disabled={(ex.type === "qcm" && choice === null) || (ex.type === "vrai_faux" && bool === null)}
            data-testid={`button-check-${n}`}
          >
            {auto ? (
              "Valider"
            ) : (
              <>
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Voir le corrigé
              </>
            )}
          </Button>
        )}
      </div>
    </article>
  );
}

export function ExercisesView({ exercises }: { exercises: Exercises }) {
  const [filter, setFilter] = useState<"tous" | Exercise["difficulty"]>("tous");
  const [results, setResults] = useState<Record<number, boolean | null | undefined>>({});
  const list = exercises.items.map((ex, i) => ({ ex, i })).filter(({ ex }) => filter === "tous" || ex.difficulty === filter);
  const auto = Object.values(results).filter((r) => r === true || r === false);
  const good = auto.filter(Boolean).length;
  return (
    <div data-testid="view-exercises">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["tous", "facile", "moyen", "difficile"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              data-testid={`filter-difficulty-${f}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium capitalize",
                filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground" data-testid="text-exercise-score">
          Score : <strong className="tabular-nums text-foreground">{good}</strong> / {auto.length} questions auto-corrigées
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map(({ ex, i }) => (
          <ExerciseCard key={i} ex={ex} n={i + 1} onResult={(r) => setResults((s) => ({ ...s, [i]: r }))} />
        ))}
      </div>
    </div>
  );
}

// ---------------- EXAMEN ----------------
export function ExamView({ exam, courseId }: { exam: Exam; courseId: number }) {
  const [phase, setPhase] = useState<"intro" | "running" | "grading" | "done">("intro");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [left, setLeft] = useState(exam.duration_minutes * 60);
  const [grade, setGrade] = useState<ExamGrade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const all = useMemo(() => exam.sections.flatMap((s) => s.questions), [exam]);
  const total = all.reduce((s, q) => s + q.points, 0);
  const answered = all.filter((q) => answers[q.id] !== undefined && String(answers[q.id]).trim() !== "").length;

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  async function submit() {
    setPhase("grading");
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/courses/${courseId}/exam/grade`, { answers });
      setGrade(await res.json());
      setPhase("done");
    } catch (e: any) {
      setError(e.message);
      setPhase("running");
    }
  }

  if (phase === "intro")
    return (
      <div className="mx-auto max-w-2xl" data-testid="view-exam">
        <div className={cn(panel, "text-center")}>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" />
          </span>
          <h3 className="mt-4 font-display text-xl font-bold">{exam.title}</h3>
          <div className="mt-4 flex flex-wrap justify-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1">
              <Clock className="h-4 w-4 text-primary" /> {exam.duration_minutes} min
            </span>
            <span className="rounded-full bg-muted px-3 py-1">{all.length} questions</span>
            <span className="rounded-full bg-muted px-3 py-1">Noté sur {total}</span>
          </div>
          {exam.instructions && <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-muted-foreground">{exam.instructions}</p>}
          <p className="mx-auto mt-3 max-w-lg text-xs text-muted-foreground">
            Les QCM sont corrigés automatiquement. Les réponses rédigées sont corrigées par l'IA selon le barème du corrigé.
          </p>
          <Button size="lg" className="mt-6" onClick={() => setPhase("running")} data-testid="button-start-exam">
            Commencer l'examen
          </Button>
        </div>
      </div>
    );

  if (phase === "done" && grade) {
    const on20 = grade.max ? (grade.score / grade.max) * 20 : 0;
    const byId = new Map(grade.per_question.map((p) => [p.id, p]));
    return (
      <div className="space-y-5" data-testid="view-exam-result">
        <div className="grid gap-5 rounded-2xl bg-[#1A1033] p-6 text-white sm:grid-cols-[auto_minmax(0,1fr)] sm:p-8">
          <div className="text-center sm:pr-8 sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#C49FFF]">Ta note</p>
            <p className="mt-1 font-display text-5xl font-extrabold tabular-nums" data-testid="text-exam-score">
              {on20.toFixed(1).replace(".", ",")}
              <span className="text-2xl text-white/60">/20</span>
            </p>
            {grade.max !== 20 && (
              <p className="mt-1 text-sm text-white/60">
                {String(grade.score).replace(".", ",")} / {grade.max} points
              </p>
            )}
          </div>
          <div className="min-w-0 sm:border-l sm:border-white/10 sm:pl-8">
            {grade.overall_feedback && <p className="text-sm leading-6 text-white/85">{grade.overall_feedback}</p>}
            {grade.priorities.length > 0 && (
              <>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#FE277E]">À retravailler</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {grade.priorities.map((p) => (
                    <li key={p} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
                      {p}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        {exam.sections.map((s) => (
          <div key={s.title} className={panel}>
            <h3 className="mb-4 text-sm font-semibold">{s.title}</h3>
            <div className="space-y-4">
              {s.questions.map((q) => {
                const g = byId.get(q.id);
                const full = g && g.points_awarded >= g.max_points;
                return (
                  <div key={q.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-6">{q.question}</p>
                      <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums", full ? "bg-secondary text-primary" : "bg-[#8A0D1E]/10 text-[#8A0D1E]")}>
                        {g?.points_awarded ?? 0}/{q.points}
                      </span>
                    </div>
                    {q.type === "ouverte" && answers[q.id] && (
                      <p className="mt-2 whitespace-pre-line rounded-lg bg-muted/60 px-3 py-2 text-sm leading-6 text-muted-foreground">{answers[q.id]}</p>
                    )}
                    {g?.feedback && <p className="mt-2 text-sm leading-6">{g.feedback}</p>}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-primary">Voir le corrigé</summary>
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-foreground/85">{q.model_answer}</p>
                    </details>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => {
              setAnswers({});
              setGrade(null);
              setLeft(exam.duration_minutes * 60);
              setPhase("intro");
            }}
            data-testid="button-retake-exam"
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Repasser l'examen
          </Button>
        </div>
      </div>
    );
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div data-testid="view-exam-running">
      <div className="sticky top-14 z-20 -mx-1 mb-5 flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card/95 px-4 py-3 backdrop-blur lg:top-2">
        <span className="text-sm text-muted-foreground">
          <strong className="text-foreground tabular-nums">{answered}</strong>/{all.length} réponses
        </span>
        <span className={cn("inline-flex items-center gap-1.5 font-display text-lg font-bold tabular-nums", left < 300 && "text-[#C3155D]")} data-testid="text-exam-timer">
          <Clock className="h-4 w-4" /> {mm}:{ss}
        </span>
        <Button size="sm" onClick={submit} disabled={phase === "grading"} data-testid="button-submit-exam">
          {phase === "grading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {phase === "grading" ? "Correction…" : "Rendre ma copie"}
        </Button>
      </div>
      {left === 0 && <p className="mb-4 rounded-lg bg-[#FE277E]/10 px-4 py-2 text-sm text-[#C3155D]">Temps écoulé. Tu peux encore rendre ta copie.</p>}
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-5">
        {exam.sections.map((s) => (
          <section key={s.title} className={panel}>
            <h3 className="mb-4 text-sm font-semibold">{s.title}</h3>
            <div className="space-y-6">
              {s.questions.map((q, qi) => (
                <div key={q.id}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[15px] font-medium leading-7">
                      <span className="mr-1.5 text-primary">{qi + 1}.</span>
                      {q.question}
                    </p>
                    <span className="shrink-0 text-xs text-muted-foreground">{q.points} pt{q.points > 1 ? "s" : ""}</span>
                  </div>
                  {q.type === "qcm" ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {q.options?.map((o, i) => (
                        <button
                          key={i}
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                          data-testid={`exam-option-${q.id}-${i}`}
                          className={cn(
                            "flex items-start gap-3 rounded-xl border px-4 py-2.5 text-left text-sm leading-6",
                            answers[q.id] === i ? "border-primary bg-secondary/60" : "border-border hover:border-primary/40",
                          )}
                        >
                          <span className="font-bold text-primary">{String.fromCharCode(65 + i)}</span>
                          <span className="min-w-0">{o}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Textarea
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      className="mt-3 min-h-[140px] text-base leading-6 md:text-sm"
                      placeholder="Ta réponse…"
                      data-testid={`exam-answer-${q.id}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <Button size="lg" onClick={submit} disabled={phase === "grading"} data-testid="button-submit-exam-bottom">
          {phase === "grading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Rendre ma copie
        </Button>
      </div>
    </div>
  );
}

export { X };
