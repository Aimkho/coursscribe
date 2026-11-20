import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Brain,
  ClipboardList,
  Download,
  FileText,
  Globe2,
  GraduationCap,
  Loader2,
  NotebookPen,
  Printer,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  User2,
  Wand2,
} from "lucide-react";
import type { Course } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, audioUrl, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/useRecorder";
import { formatDate } from "@/components/CourseCard";
import { NotesView, SheetView, ExercisesView, ExamView } from "@/components/StudyViews";
import { autoAnalyze } from "./RecordPage";

type Kind = "notes" | "sheet" | "exercises" | "exam";
type Tab = Kind | "transcript";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "notes", label: "Notes", icon: NotebookPen },
  { id: "sheet", label: "Fiche de révision", icon: Brain },
  { id: "exercises", label: "Exercices", icon: ClipboardList },
  { id: "exam", label: "Examen blanc", icon: GraduationCap },
  { id: "transcript", label: "Transcription", icon: FileText },
];

const GEN_INFO: Record<Kind, { title: string; text: string; cta: string }> = {
  notes: {
    title: "Analyse du cours",
    text: "L'IA extrait l'essentiel : idée centrale, plan, définitions, formules, exemples et réponses utiles aux questions d'élèves. Les hésitations et digressions sont écartées.",
    cta: "Analyser le cours",
  },
  sheet: {
    title: "Fiche de révision approfondie",
    text: "Points incontournables, flashcards, erreurs à éviter, astuces de mémorisation et checklist avant l'examen.",
    cta: "Créer la fiche",
  },
  exercises: {
    title: "Exercices corrigés",
    text: "Une douzaine d'exercices progressifs : QCM, vrai/faux, questions ouvertes et cas d'application, avec corrigés détaillés.",
    cta: "Générer les exercices",
  },
  exam: {
    title: "Examen blanc noté sur 20",
    text: "Un sujet chronométré, avec QCM corrigés automatiquement et questions rédigées corrigées par l'IA selon un barème.",
    cta: "Générer l'examen",
  },
};

export default function CoursePage({ id, publicView }: { id: number; publicView?: boolean }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: course, isLoading, error } = useQuery<Course>({ queryKey: ["/api/courses", id] });
  const [tab, setTab] = useState<Tab>("notes");
  const [pending, setPending] = useState<Set<Kind>>(new Set());
  const [genError, setGenError] = useState<Partial<Record<Kind, string>>>({});
  const [draft, setDraft] = useState<string | null>(null);
  const [savingText, setSavingText] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const autoRan = useRef(false);

  const owner = !!course?.isOwner && !publicView;

  async function generate(kind: Kind) {
    setPending((p) => new Set(p).add(kind));
    setGenError((e) => ({ ...e, [kind]: undefined }));
    try {
      const res = await apiRequest("POST", `/api/courses/${id}/generate/${kind}`);
      const updated: Course = await res.json();
      queryClient.setQueryData(["/api/courses", id], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/courses"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
    } catch (e: any) {
      setGenError((s) => ({ ...s, [kind]: e.message }));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(kind);
        return n;
      });
    }
  }

  async function generateAll() {
    if (!course?.notes) await generate("notes");
    const latest = queryClient.getQueryData<Course>(["/api/courses", id]);
    if (!latest?.notes) return;
    await Promise.all((["sheet", "exercises", "exam"] as Kind[]).filter((k) => !latest[k]).map((k) => generate(k)));
  }

  useEffect(() => {
    if (course && owner && autoAnalyze.id === id && !autoRan.current) {
      autoRan.current = true;
      autoAnalyze.id = null;
      generateAll();
    }
  }, [course, owner]);

  async function patch(data: Record<string, unknown>) {
    const res = await apiRequest("PATCH", `/api/courses/${id}`, data);
    const updated: Course = await res.json();
    queryClient.setQueryData(["/api/courses", id], updated);
    queryClient.invalidateQueries({ queryKey: ["/api/courses"], exact: true });
    queryClient.invalidateQueries({ queryKey: ["/api/library"] });
    return updated;
  }

  async function togglePublic(v: boolean) {
    try {
      await patch({ isPublic: v });
      toast({
        title: v ? "Cours publié" : "Cours retiré de la bibliothèque",
        description: v ? "Tous les utilisateurs de CoursScribe peuvent maintenant le consulter." : "Il n'est plus visible que par toi.",
      });
    } catch (e: any) {
      toast({ title: "Modification impossible", description: e.message, variant: "destructive" });
    }
  }

  async function saveTranscript() {
    if (draft === null) return;
    setSavingText(true);
    try {
      await patch({ transcript: draft });
      setDraft(null);
      toast({ title: "Transcription enregistrée", description: "Relance l'analyse pour mettre à jour les notes." });
    } catch (e: any) {
      toast({ title: "Enregistrement impossible", description: e.message, variant: "destructive" });
    } finally {
      setSavingText(false);
    }
  }

  async function remove() {
    try {
      await apiRequest("DELETE", `/api/courses/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library"] });
      navigate("/");
    } catch (e: any) {
      toast({ title: "Suppression impossible", description: e.message, variant: "destructive" });
    }
  }

  if (isLoading)
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted/60" />
      </div>
    );
  if (error || !course)
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">{(error as Error)?.message || "Cours introuvable."}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={publicView ? "/library" : "/"}>Retour</Link>
        </Button>
      </div>
    );

  const words = course.transcript.trim() ? course.transcript.trim().split(/\s+/).length : 0;
  const anyPending = pending.size > 0;
  const missing = (["notes", "sheet", "exercises", "exam"] as Kind[]).filter((k) => !course[k]);

  function renderTab() {
    if (!course) return null;
    if (tab === "transcript")
      return (
        <div className="rounded-2xl border border-card-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <span className="text-xs text-muted-foreground">{words.toLocaleString("fr-FR")} mots · texte brut du cours</span>
            {owner && draft !== null && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  Annuler
                </Button>
                <Button size="sm" onClick={saveTranscript} disabled={savingText} data-testid="button-save-transcript">
                  {savingText ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Enregistrer
                </Button>
              </div>
            )}
          </div>
          {owner ? (
            <Textarea
              value={draft ?? course.transcript}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[480px] resize-y rounded-none border-0 px-5 py-4 text-[15px] leading-7 shadow-none focus-visible:ring-0"
              data-testid="textarea-course-transcript"
            />
          ) : (
            <p className="whitespace-pre-line px-5 py-4 text-[15px] leading-7 text-foreground/85">{course.transcript || "Pas de transcription."}</p>
          )}
        </div>
      );

    const kind = tab as Kind;
    const content = course[kind];
    const isPending = pending.has(kind) || (kind !== "notes" && pending.has("notes") && !course.notes);
    if (isPending)
      return (
        <div className="flex flex-col items-center rounded-2xl border border-card-border bg-card px-6 py-16 text-center" data-testid={`status-generating-${kind}`}>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-base font-semibold">{GEN_INFO[kind].title} en cours…</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            L'IA lit tout le cours. Cela prend généralement entre 20 secondes et 1 minute selon sa longueur.
          </p>
        </div>
      );
    if (!content)
      return (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-secondary/30 px-6 py-14 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-base font-semibold">{GEN_INFO[kind].title}</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{GEN_INFO[kind].text}</p>
          {genError[kind] && (
            <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {genError[kind]}
            </p>
          )}
          {owner ? (
            words < 40 ? (
              <p className="mt-5 text-sm text-muted-foreground">
                La transcription contient {words} mots : il en faut au moins 40. Complète-la dans l'onglet Transcription.
              </p>
            ) : (
              <Button className="mt-6" onClick={() => generate(kind)} data-testid={`button-generate-${kind}`}>
                <Wand2 className="mr-2 h-4 w-4" /> {genError[kind] ? "Réessayer" : GEN_INFO[kind].cta}
              </Button>
            )
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">L'auteur n'a pas encore généré ce contenu.</p>
          )}
        </div>
      );

    return (
      <div>
        {owner && (
          <div className="no-print mb-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => generate(kind)} data-testid={`button-regenerate-${kind}`}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Régénérer
            </Button>
          </div>
        )}
        {kind === "notes" && course.notes && <NotesView notes={course.notes} />}
        {kind === "sheet" && course.sheet && <SheetView sheet={course.sheet} />}
        {kind === "exercises" && course.exercises && <ExercisesView exercises={course.exercises} />}
        {kind === "exam" && course.exam && <ExamView key={JSON.stringify(course.exam).length} exam={course.exam} courseId={course.id} />}
      </div>
    );
  }

  return (
    <div>
      <Link
        href={publicView ? "/library" : "/"}
        className="no-print mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        data-testid="link-back"
      >
        <ArrowLeft className="h-4 w-4" /> {publicView ? "Bibliothèque" : "Mes cours"}
      </Link>

      <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {course.subject && <span className="font-semibold uppercase tracking-wider text-primary">{course.subject}</span>}
            {course.level && <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">{course.level}</span>}
          </div>
          <h1 className="mt-1.5 break-anywhere font-display text-xl font-bold leading-tight" data-testid="text-course-title">
            {course.title}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {!owner && (
              <span className="inline-flex items-center gap-1">
                <User2 className="h-3.5 w-3.5" /> {course.ownerName}
              </span>
            )}
            <span>{formatDate(course.createdAt)}</span>
            {course.durationSec > 0 && <span>{formatDuration(course.durationSec)} d'enregistrement</span>}
            <span>{words.toLocaleString("fr-FR")} mots</span>
          </p>
        </div>

        {owner && (
          <div className="no-print flex flex-wrap items-center gap-2">
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2",
                course.isPublic ? "border-[#FE277E]/30 bg-[#FE277E]/5" : "border-border bg-card",
              )}
            >
              <Globe2 className={cn("h-4 w-4", course.isPublic ? "text-[#C3155D]" : "text-muted-foreground")} />
              <span className="text-sm font-medium">{course.isPublic ? "Publié" : "Publier"}</span>
              <Switch checked={course.isPublic} onCheckedChange={togglePublic} data-testid="switch-public" aria-label="Publier dans la bibliothèque" />
            </label>
            <Button variant="outline" size="icon" onClick={() => window.print()} aria-label="Imprimer" title="Imprimer ou enregistrer en PDF" data-testid="button-print">
              <Printer className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setConfirmDelete(true)}
              aria-label="Supprimer le cours"
              className="text-[#8A0D1E] hover:bg-[#8A0D1E]/5"
              data-testid="button-delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </header>

      {owner && course.hasAudio && (
        <div className="no-print mb-6 flex flex-col gap-3 rounded-2xl border border-card-border bg-card p-3 sm:flex-row sm:items-center">
          <audio controls preload="none" src={audioUrl(course.id)} className="h-10 w-full min-w-0 flex-1" data-testid="audio-player" />
          <Button variant="ghost" size="sm" asChild>
            <a href={audioUrl(course.id, true)} target="_blank" rel="noopener noreferrer" data-testid="link-download-audio">
              <Download className="mr-1.5 h-4 w-4" /> Audio
            </a>
          </Button>
        </div>
      )}

      {owner && missing.length > 0 && words >= 40 && (
        <div className="no-print mb-6 flex flex-col gap-3 rounded-2xl bg-primary p-4 text-primary-foreground sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-sm font-semibold">{anyPending ? "Génération en cours…" : "Tout préparer en un clic"}</p>
            <p className="text-sm text-white/80">
              {anyPending ? "Tu peux parcourir les onglets pendant ce temps." : "Notes, fiche de révision, exercices et examen blanc à partir de ce cours."}
            </p>
          </div>
          <Button variant="secondary" onClick={generateAll} disabled={anyPending} className="shrink-0" data-testid="button-generate-all">
            {anyPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {anyPending ? "En cours" : "Tout générer"}
          </Button>
        </div>
      )}

      <div className="no-print -mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex min-w-full gap-1 border-b border-border sm:min-w-0">
          {TABS.map((t) => {
            const ready = t.id === "transcript" || !!course[t.id as Kind];
            const busy = t.id !== "transcript" && pending.has(t.id as Kind);
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`tab-${t.id}`}
                className={cn(
                  "-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                  tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className={cn("h-4 w-4", tab === t.id && "text-primary")} />
                {t.label}
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  t.id !== "transcript" && <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-primary" : "bg-border")} aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {renderTab()}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce cours ?</AlertDialogTitle>
            <AlertDialogDescription>
              La transcription, l'audio, les notes, la fiche, les exercices et l'examen seront définitivement supprimés
              {course.isPublic ? ", et le cours disparaîtra de la bibliothèque publique" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-[#8A0D1E] hover:bg-[#740b19]" data-testid="button-confirm-delete">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
