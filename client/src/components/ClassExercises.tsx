import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Flag,
  FlagOff,
  ImageIcon,
  Lightbulb,
  ListOrdered,
  Loader2,
  PenLine,
  RefreshCw,
  ScanText,
  Target,
  Trash2,
  Wand2,
  FileText,
} from "lucide-react";
import type { Attachment, ClassExercise, Course } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { apiRequest, apiUploadAttachment, attachmentUrl, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const MARK_RE = /\[Exercice (\d+) — (début|fin)\]/g;

/** Numéro de l'exercice ouvert (repère « début » sans « fin ») et prochain numéro libre. */
export function exerciseState(text: string) {
  let max = 0;
  let open: number | null = null;
  for (const m of Array.from(text.matchAll(MARK_RE))) {
    const n = Number(m[1]);
    max = Math.max(max, n);
    if (m[2] === "début") open = n;
    else if (open === n) open = null;
  }
  return { open, next: max + 1 };
}

export const markerText = (n: number, kind: "début" | "fin") => `[Exercice ${n} — ${kind}]`;

type LocalPhoto = { key: string; preview: string | null; name: string; exerciseNo: number | null; status: "upload" | "ok" | "error"; message?: string };

/**
 * Panneau de la page d'enregistrement : repères d'exercice et photos d'énoncé.
 * Les repères sont insérés à leur place dans la transcription ; les photos sont liées à l'exercice ouvert.
 */
export function ExerciseRecordPanel({
  text,
  live,
  onMarker,
  ensureCourse,
}: {
  text: string;
  live: boolean;
  onMarker: (marker: string) => void;
  ensureCourse: () => Promise<{ courseId: number; sessionId: number | null }>;
}) {
  const { toast } = useToast();
  const { open, next } = useMemo(() => exerciseState(text), [text]);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function toggle() {
    if (open) onMarker(markerText(open, "fin"));
    else onMarker(markerText(next, "début"));
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const exerciseNo = open ?? (next > 1 ? next - 1 : null);
    for (const file of Array.from(files)) {
      const key = `${Date.now()}-${file.name}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setPhotos((p) => [...p, { key, preview, name: file.name, exerciseNo, status: "upload" }]);
      try {
        const { courseId, sessionId } = await ensureCourse();
        const att = await apiUploadAttachment(courseId, file, { exerciseNo, sessionId });
        setPhotos((p) =>
          p.map((x) =>
            x.key === key
              ? { ...x, status: att.readError ? "error" : "ok", message: att.readError ? "Photo gardée, mais l'énoncé n'a pas pu être lu. Il sera relu à l'analyse." : undefined }
              : x,
          ),
        );
      } catch (e: any) {
        setPhotos((p) => p.map((x) => (x.key === key ? { ...x, status: "error", message: e.message } : x)));
        toast({ title: "Photo non envoyée", description: e.message, variant: "destructive" });
      }
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-border p-3.5" data-testid="panel-class-exercises">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <PenLine className="h-4 w-4 text-primary" /> Exercices en classe
        </p>
        {open && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FE277E]/10 px-2 py-0.5 text-xs font-semibold text-[#C3155D]" data-testid="status-exercise-open">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FE277E]" /> Exercice {open} en cours
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant={open ? "default" : "outline"}
          className={cn("h-11 px-2", open && "bg-[#FE277E] hover:bg-[#e8206f]")}
          onClick={toggle}
          data-testid="button-exercise-marker"
        >
          {open ? <FlagOff className="mr-2 h-4 w-4" /> : <Flag className="mr-2 h-4 w-4" />}
          {open ? `Fin ex. ${open}` : `Début ex. ${next}`}
        </Button>
        <Button variant="outline" className="h-11 px-2" onClick={() => inputRef.current?.click()} data-testid="button-add-statement">
          <Camera className="mr-2 h-4 w-4" /> Photo énoncé
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files;
            addFiles(f).finally(() => (e.target.value = ""));
          }}
          data-testid="input-statement"
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {live
          ? "Appuie sur « Début » quand le prof lance un exercice et sur « Fin » après la correction. Photographie le tableau, la feuille ou la page du livre."
          : "Les repères et les photos aident l'IA à relier chaque énoncé à la correction du prof."}
      </p>
      {photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="list-statement-photos">
          {photos.map((p) => (
            <li key={p.key} className="relative overflow-hidden rounded-lg border border-border bg-muted" title={p.message || p.name}>
              {p.preview ? (
                <img src={p.preview} alt="" className="aspect-[4/3] w-full bg-white object-contain" />
              ) : (
                <div className="grid aspect-[4/3] place-items-center text-muted-foreground">
                  <FileText className="h-6 w-6" />
                </div>
              )}
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {p.exerciseNo ? `Ex. ${p.exerciseNo}` : "Énoncé"}
              </span>
              <span
                className={cn(
                  "absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full",
                  p.status === "upload" && "bg-white text-primary",
                  p.status === "ok" && "bg-primary text-white",
                  p.status === "error" && "bg-[#8A0D1E] text-white",
                )}
              >
                {p.status === "upload" ? <Loader2 className="h-3 w-3 animate-spin" /> : p.status === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Onglet « En classe » de la page du cours ----------------

const panel = "rounded-2xl border border-card-border bg-card p-5 sm:p-6";

function Thumb({ courseId, att, onDelete, onRenumber, owner }: { courseId: number; att: Attachment; owner: boolean; onDelete?: () => void; onRenumber?: (n: number | null) => void }) {
  const url = attachmentUrl(courseId, att.id);
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card" data-testid={`attachment-${att.id}`}>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block bg-muted">
        {att.kind === "image" ? (
          <img src={url} alt={att.label || "Énoncé"} loading="lazy" className="aspect-[4/3] w-full bg-white object-contain" />
        ) : (
          <div className="grid aspect-[4/3] place-items-center text-muted-foreground">
            <FileText className="h-8 w-8" />
          </div>
        )}
      </a>
      <figcaption className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs">
        {owner && onRenumber ? (
          <select
            value={att.exerciseNo ?? ""}
            onChange={(e) => onRenumber(e.target.value ? Number(e.target.value) : null)}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
            aria-label="Exercice concerné"
          >
            <option value="">Sans numéro</option>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Exercice {n}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-medium">{att.exerciseNo ? `Exercice ${att.exerciseNo}` : "Énoncé"}</span>
        )}
        <span className="flex items-center gap-1.5">
          {att.extracted ? (
            <ScanText className="h-3.5 w-3.5 text-primary" aria-label="Énoncé lu" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-[#C3155D]" aria-label="Énoncé non lu" />
          )}
          {owner && onDelete && (
            <button onClick={onDelete} className="text-muted-foreground hover:text-[#8A0D1E]" aria-label="Supprimer la photo">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </figcaption>
    </figure>
  );
}

function ClassExerciseCard({ ex, course, owner, onAddPhoto }: { ex: ClassExercise; course: Course; owner: boolean; onAddPhoto: (n: number) => void }) {
  const [showCorrection, setShowCorrection] = useState(false);
  const atts = course.attachments.filter((a) => ex.attachment_ids.includes(a.id) || a.exerciseNo === ex.number);
  return (
    <article className={panel} data-testid={`class-exercise-${ex.number}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Exercice {ex.number}</p>
          <h3 className="mt-1 font-display text-lg font-bold leading-snug">{ex.title}</h3>
          {ex.reference && <p className="mt-0.5 text-sm text-muted-foreground">{ex.reference}</p>}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            ex.statement_source === "transcription" ? "bg-muted text-muted-foreground" : "bg-secondary text-secondary-foreground",
          )}
        >
          {ex.statement_source === "transcription" ? <PenLine className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {ex.statement_source === "photo" ? "Énoncé photographié" : ex.statement_source === "photo_et_transcription" ? "Photo + cours" : "Énoncé reconstitué du cours"}
        </span>
      </div>

      {ex.statement && (
        <div className="mt-4 rounded-xl border border-[#7D4FFE]/20 bg-[#7D4FFE]/[0.04] p-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Énoncé</p>
          <p className="whitespace-pre-line text-[15px] leading-7">{ex.statement}</p>
        </div>
      )}
      {!ex.statement_complete && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[#FE277E]/30 bg-[#FE277E]/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-2 text-sm text-[#8A0D1E]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {ex.missing || "L'énoncé n'a pas été dit en entier pendant le cours."}
          </p>
          {owner && (
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => onAddPhoto(ex.number)} data-testid={`button-photo-exercise-${ex.number}`}>
              <Camera className="mr-1.5 h-3.5 w-3.5" /> Ajouter la photo
            </Button>
          )}
        </div>
      )}
      {atts.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {atts.map((a) => (
            <Thumb key={a.id} courseId={course.id} att={a} owner={false} />
          ))}
        </div>
      )}

      {ex.correction.length > 0 || ex.final_answer ? (
        <div className="mt-5">
          <Button variant={showCorrection ? "secondary" : "default"} size="sm" onClick={() => setShowCorrection((v) => !v)} data-testid={`button-correction-${ex.number}`}>
            {showCorrection ? "Masquer la correction" : "Voir la correction du prof"}
          </Button>
          {showCorrection && (
            <div className="mt-4 space-y-4">
              <ol className="space-y-3">
                {ex.correction.map((c, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>
                    <div className="min-w-0">
                      {c.step && <p className="text-sm font-semibold">{c.step}</p>}
                      <p className="whitespace-pre-line text-[15px] leading-7 text-foreground/85">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {ex.final_answer && (
                <div className="rounded-xl bg-[#1A1033] p-4 text-white">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C49FFF]">Résultat</p>
                  <p className="mt-1 whitespace-pre-line text-[15px] leading-7">{ex.final_answer}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Pas de correction donnée pendant le cours pour cet exercice.</p>
      )}

      {(ex.method.length > 0 || ex.pitfalls.length > 0) && (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {ex.method.length > 0 && (
            <div className="rounded-xl border border-border p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ListOrdered className="h-4 w-4 text-primary" /> Méthode à retenir
              </p>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6">
                {ex.method.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ol>
            </div>
          )}
          {ex.pitfalls.length > 0 && (
            <div className="rounded-xl border border-[#FE277E]/25 bg-[#FE277E]/[0.04] p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#8A0D1E]">
                <Target className="h-4 w-4" /> Pièges vus en classe
              </p>
              <ul className="space-y-1.5 text-sm leading-6">
                {ex.pitfalls.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <Lightbulb className="mt-1 h-3.5 w-3.5 shrink-0 text-[#C3155D]" /> {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function ClassExercisesView({
  course,
  owner,
  pending,
  error,
  onGenerate,
}: {
  course: Course;
  owner: boolean;
  pending: boolean;
  error?: string;
  onGenerate: () => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetNo = useRef<number | null>(null);
  const [uploading, setUploading] = useState(0);
  const items = course.classExercises?.items ?? [];
  const markers = (course.transcript.match(MARK_RE) || []).length;
  const words = course.transcript.trim() ? course.transcript.trim().split(/\s+/).length : 0;
  const unlinked = course.attachments.filter((a) => !items.some((e) => e.attachment_ids.includes(a.id) || e.number === a.exerciseNo));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/courses", course.id] });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        await apiUploadAttachment(course.id, f, { exerciseNo: targetNo.current });
      } catch (e: any) {
        toast({ title: "Photo non envoyée", description: e.message, variant: "destructive" });
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await refresh();
    toast({ title: "Énoncé ajouté", description: "Relance l'analyse des exercices pour l'intégrer à la correction." });
  }
  function pick(n: number | null) {
    targetNo.current = n;
    inputRef.current?.click();
  }
  async function remove(id: number) {
    await apiRequest("DELETE", `/api/courses/${course.id}/attachments/${id}`);
    refresh();
  }
  async function renumber(id: number, n: number | null) {
    await apiRequest("PATCH", `/api/courses/${course.id}/attachments/${id}`, { exerciseNo: n });
    refresh();
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*,application/pdf"
      multiple
      className="sr-only"
      onChange={(e) => {
        upload(e.target.files).finally(() => (e.target.value = ""));
      }}
      data-testid="input-course-statement"
    />
  );

  if (pending)
    return (
      <div className="flex flex-col items-center rounded-2xl border border-card-border bg-card px-6 py-16 text-center" data-testid="status-generating-class">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-base font-semibold">Recherche des exercices faits en classe…</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">L'IA relie les énoncés photographiés à la correction donnée par le prof.</p>
      </div>
    );

  return (
    <div className="space-y-5" data-testid="view-class">
      {fileInput}
      {items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-secondary/30 px-6 py-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <PenLine className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-semibold">{course.classExercises ? "Aucun exercice trouvé dans ce cours" : "Exercices faits en classe"}</h3>
          <p className="mx-auto mt-1.5 max-w-lg text-sm leading-6 text-muted-foreground">
            L'IA retrouve chaque exercice traité en cours, reprend l'énoncé (photo ou texte dit par le prof) et remet au propre la correction, la méthode et les
            pièges. Les exercices et l'examen blanc s'en inspirent ensuite.
          </p>
          <p className="mx-auto mt-3 max-w-lg text-xs text-muted-foreground">
            {course.attachments.length} énoncé{course.attachments.length > 1 ? "s" : ""} en photo · {Math.floor(markers / 2)} exercice{markers >= 4 ? "s" : ""} repéré
            {markers >= 4 ? "s" : ""} pendant l'enregistrement
          </p>
          {error && (
            <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {owner && (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => pick(null)} disabled={uploading > 0} data-testid="button-upload-statement">
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />} Ajouter un énoncé
              </Button>
              {(words >= 40 || course.attachments.length > 0) && (
                <Button onClick={onGenerate} data-testid="button-generate-class">
                  <Wand2 className="mr-2 h-4 w-4" /> {course.classExercises ? "Relancer la recherche" : "Retrouver les exercices"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {items.length > 0 && owner && (
        <div className="no-print flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => pick(null)} disabled={uploading > 0} data-testid="button-upload-statement">
            {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-1.5 h-3.5 w-3.5" />} Ajouter un énoncé
          </Button>
          <Button variant="ghost" size="sm" onClick={onGenerate} data-testid="button-regenerate-class">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Régénérer
          </Button>
        </div>
      )}
      {items.map((ex) => (
        <ClassExerciseCard key={ex.number} ex={ex} course={course} owner={owner} onAddPhoto={(n) => pick(n)} />
      ))}

      {owner && course.attachments.length > 0 && (items.length === 0 || unlinked.length > 0) && (
        <section className={panel}>
          <p className="mb-3 text-sm font-semibold">{items.length ? "Énoncés non reliés à un exercice" : "Énoncés ajoutés"}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(items.length ? unlinked : course.attachments).map((a) => (
              <Thumb key={a.id} courseId={course.id} att={a} owner onDelete={() => remove(a.id)} onRenumber={(n) => renumber(a.id, n)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
