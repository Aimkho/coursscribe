import { Link } from "wouter";
import { Clock, FileText, Globe2, Lock, User2 } from "lucide-react";
import type { CourseSummary } from "@shared/schema";
import { formatDuration } from "@/lib/useRecorder";

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={
        done
          ? "rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
          : "rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}

export function CourseCard({ c, href, showOwner }: { c: CourseSummary; href: string; showOwner?: boolean }) {
  return (
    <Link
      href={href}
      data-testid={`card-course-${c.id}`}
      className="group flex min-w-0 flex-col rounded-2xl border border-card-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_8px_30px_-12px_rgba(125,79,254,0.35)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-primary">{c.subject || "Sans matière"}</span>
        {c.isPublic ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FE277E]/10 px-2 py-0.5 text-xs font-medium text-[#C3155D]">
            <Globe2 className="h-3 w-3" /> Public
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Privé
          </span>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 break-anywhere text-base font-semibold leading-snug group-hover:text-primary">{c.title}</h3>
      <p className="mt-2 line-clamp-3 break-anywhere text-sm leading-relaxed text-muted-foreground">
        {c.summary || "Pas encore de contenu analysé."}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Step done={c.hasNotes} label="Notes" />
        <Step done={c.hasSheet} label="Fiche" />
        <Step done={c.hasExercises} label="Exercices" />
        <Step done={c.hasExam} label="Examen" />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground [margin-top:1rem]">
        {showOwner && (
          <span className="inline-flex items-center gap-1">
            <User2 className="h-3.5 w-3.5" /> {c.ownerName}
          </span>
        )}
        {c.durationSec > 0 && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {formatDuration(c.durationSec)}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" /> {c.wordCount.toLocaleString("fr-FR")} mots
        </span>
        <span className="ml-auto">{formatDate(c.createdAt)}</span>
      </div>
    </Link>
  );
}

export function CourseGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-56 animate-pulse rounded-2xl border border-card-border bg-muted/50" />
      ))}
    </div>
  );
}
