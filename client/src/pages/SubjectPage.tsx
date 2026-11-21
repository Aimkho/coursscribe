import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CalendarDays, Check, Clock, Mic, Pencil, Plus, Trash2, X } from "lucide-react";
import type { CourseSummary, Subject } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { StatusBadge, formatDate } from "@/components/CourseCard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDuration } from "@/lib/useRecorder";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function SubjectPage({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: subjects, isLoading: l1 } = useQuery<Subject[]>({ queryKey: ["/api/subjects"] });
  const { data: courses, isLoading: l2 } = useQuery<CourseSummary[]>({ queryKey: ["/api/courses"] });
  const subject = subjects?.find((s) => s.id === id);
  const chapters = useMemo(
    () =>
      (courses || [])
        .filter((c) => c.subjectId === id)
        .sort((a, b) => (a.chapterNumber ?? 1e9) - (b.chapterNumber ?? 1e9) || a.createdAt - b.createdAt),
    [courses, id],
  );
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);

  async function rename() {
    try {
      await apiRequest("PATCH", `/api/subjects/${id}`, { name });
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      setEditing(false);
    } catch (e: any) {
      toast({ title: "Modification impossible", description: e.message, variant: "destructive" });
    }
  }
  async function remove() {
    try {
      await apiRequest("DELETE", `/api/subjects/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      navigate("/");
    } catch (e: any) {
      toast({ title: "Suppression impossible", description: e.message, variant: "destructive" });
    }
  }

  if (l1 || l2)
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />
      </div>
    );
  if (!subject)
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">Matière introuvable.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/">Retour</Link>
        </Button>
      </div>
    );

  const done = chapters.filter((c) => c.status === "termine").length;
  const totalSec = chapters.reduce((s, c) => s + c.durationSec, 0);
  const sessions = chapters.reduce((s, c) => s + c.sessionCount, 0);

  return (
    <div>
      <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
        <ArrowLeft className="h-4 w-4" /> Mes cours
      </Link>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Matière{subject.level ? ` · ${subject.level}` : ""}</p>
          {editing ? (
            <div className="mt-1 flex max-w-md items-center gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="input-subject-name" onKeyDown={(e) => e.key === "Enter" && rename()} />
              <Button size="icon" onClick={rename} aria-label="Valider" data-testid="button-save-subject">
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditing(false)} aria-label="Annuler">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <h1 className="truncate font-display text-xl font-bold" data-testid="text-subject-name">
                {subject.name}
              </h1>
              <button
                onClick={() => {
                  setName(subject.name);
                  setEditing(true);
                }}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Renommer la matière"
                data-testid="button-rename-subject"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {chapters.length} {chapters.length > 1 ? "chapitres" : "chapitre"} · {done} terminé{done > 1 ? "s" : ""} · {sessions} séance
            {sessions > 1 ? "s" : ""} · {formatDuration(totalSec)} enregistrées
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => setConfirm(true)} aria-label="Supprimer la matière" data-testid="button-delete-subject">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button asChild data-testid="button-new-chapter">
            <Link href={`/record/subject/${id}`}>
              <Plus className="mr-2 h-4 w-4" /> Nouveau chapitre
            </Link>
          </Button>
        </div>
      </div>

      {chapters.length > 0 && (
        <div className="mb-8 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${done} chapitres terminés sur ${chapters.length}`}>
          <div className="h-full rounded-full bg-gradient-to-r from-[#7D4FFE] to-[#FE277E]" style={{ width: `${(done / chapters.length) * 100}%` }} />
        </div>
      )}

      {chapters.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-secondary/30 px-6 py-14 text-center">
          <Mic className="mx-auto h-7 w-7 text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Aucun chapitre dans cette matière pour l'instant.</p>
        </div>
      ) : (
        <ol className="relative space-y-3">
          {chapters.map((c) => (
            <li key={c.id}>
              <Link
                href={`/course/${c.id}`}
                className="group flex items-stretch gap-4 rounded-2xl border border-card-border bg-card p-4 transition-colors hover:border-primary/40"
                data-testid={`row-chapter-${c.id}`}
              >
                <span
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-base font-bold",
                    c.status === "termine" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {c.chapterNumber ?? "–"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 truncate text-[15px] font-semibold group-hover:text-primary">{c.title}</h3>
                    <StatusBadge status={c.status} />
                    {c.analysisStale && (
                      <span className="rounded-full bg-[#FE277E]/10 px-2 py-0.5 text-xs font-medium text-[#C3155D]">Analyse à mettre à jour</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{c.summary || "Pas encore analysé."}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> {c.sessionCount} séance{c.sessionCount > 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> {formatDuration(c.durationSec)}
                    </span>
                    <span>{[c.hasNotes && "Notes", c.hasSheet && "Fiche", c.hasExercises && "Exercices", c.hasExam && "Examen"].filter(Boolean).join(" · ") || "Rien de généré"}</span>
                    <span className="ml-auto">{formatDate(c.updatedAt || c.createdAt)}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la matière « {subject.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les chapitres ne sont pas supprimés : ils restent dans « Mes cours », sans matière. Tu pourras les rattacher à une autre matière.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={remove} data-testid="button-confirm-delete-subject">
              Supprimer la matière
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
