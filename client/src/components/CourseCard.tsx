import { Link } from "wouter";
import { CalendarDays, Clock, FileText, Globe2, Lock, User2 } from "lucide-react";
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

export function StatusBadge({ status, className }: { status: "en_cours" | "termine"; className?: string }) {
  return status === "termine" ? (
    <span className={"inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground " + (className || "")}>
      Terminé
    </span>
  ) : (
    <span className={"inline-flex shrink-0 items-center gap-1 rounded-full border border-[#FE277E]/30 px-2 py-0.5 text-xs font-medium text-[#C3155D] " + (className || "")}>
      <span className="h-1.5 w-1.5 rounded-full bg-[#FE277E]" /> En cours
    </span>
  );
}

export function CourseCard({ c, href, showOwner, hideSubject }: { c: CourseSummary; href: string; showOwner?: boolean; hideSubject?: boolean }) {
  return (
    <Link
      href={href}
      data-testid={`card-course-${c.id}`}
      className="cs-card group flex min-w-0 flex-col rounded-2xl border border-card-border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-primary">
          {hideSubject ? (c.chapterNumber ? `Chapitre ${c.chapterNumber}` : "Chapitre") : c.subject || "Sans matière"}
          {!hideSubject && c.chapterNumber ? ` · Chap. ${c.chapterNumber}` : ""}
        </span>
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
      <h3 className="mt-2 line-clamp-2 break-anywhere text-base font-semibold leading-snug transition-colors group-hover:text-primary">{c.title}</h3>
      <p className="mt-2 line-clamp-3 break-anywhere text-sm leading-relaxed text-muted-foreground">
        {c.summary || "Pas encore de contenu analysé."}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {!showOwner && <StatusBadge status={c.status} />}
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
        {c.sessionCount > 1 && (
          <span className="inline-flex items-center gap-1" data-testid={`text-sessions-${c.id}`}>
            <CalendarDays className="h-3.5 w-3.5" /> {c.sessionCount} séances
          </span>
        )}
        <span className="ml-auto">{formatDate(c.updatedAt || c.createdAt)}</span>
      </div>
    </Link>
  );
}

export function CourseGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="cs-shimmer h-56 rounded-2xl border border-card-border" />
      ))}
    </div>
  );
}
