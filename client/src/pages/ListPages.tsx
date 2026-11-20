import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Globe2, Mic, Search, BookOpenCheck } from "lucide-react";
import type { CourseSummary } from "@shared/schema";
import { CourseCard, CourseGridSkeleton } from "@/components/CourseCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/useRecorder";

function useFiltered(list: CourseSummary[] | undefined) {
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState<string>("Toutes");
  const subjects = useMemo(() => {
    const s = new Set<string>();
    (list || []).forEach((c) => c.subject && s.add(c.subject));
    return ["Toutes", ...Array.from(s).sort((a, b) => a.localeCompare(b, "fr"))];
  }, [list]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (list || []).filter(
      (c) =>
        (subject === "Toutes" || c.subject === subject) &&
        (!n || `${c.title} ${c.subject} ${c.summary} ${c.ownerName}`.toLowerCase().includes(n)),
    );
  }, [list, q, subject]);
  return { q, setQ, subject, setSubject, subjects, filtered };
}

function Filters({ f, placeholder }: { f: ReturnType<typeof useFiltered>; placeholder: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder={placeholder} className="pl-9" data-testid="input-search" />
      </div>
      {f.subjects.length > 2 && (
        <div className="flex flex-wrap gap-2">
          {f.subjects.map((s) => (
            <button
              key={s}
              onClick={() => f.setSubject(s)}
              data-testid={`filter-subject-${s}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                f.subject === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery<CourseSummary[]>({ queryKey: ["/api/courses"] });
  const f = useFiltered(data);
  const totalSec = (data || []).reduce((s, c) => s + c.durationSec, 0);
  const firstName = user?.name.split(" ")[0];

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Bonjour {firstName}</p>
          <h1 className="font-display text-xl font-bold">Mes cours</h1>
        </div>
        <Button asChild size="lg" data-testid="button-new-course">
          <Link href="/record">
            <Mic className="mr-2 h-4 w-4" /> Enregistrer un cours
          </Link>
        </Button>
      </div>

      {data && data.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Cours" value={String(data.length)} />
          <Stat label="Temps enregistré" value={formatDuration(totalSec)} />
          <Stat label="Fiches prêtes" value={String(data.filter((c) => c.hasSheet).length)} />
          <Stat label="Cours publiés" value={String(data.filter((c) => c.isPublic).length)} />
        </div>
      )}

      {isLoading && <CourseGridSkeleton />}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

      {data && data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-secondary/40 px-6 py-14 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Mic className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Ton premier cours t'attend</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Lance l'enregistrement au début du cours : la transcription s'affiche en direct, puis CoursScribe en tire tes notes, ta fiche et tes
            exercices.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild data-testid="button-empty-record">
              <Link href="/record">Enregistrer un cours</Link>
            </Button>
            <Button asChild variant="outline" data-testid="button-empty-library">
              <Link href="/library">Explorer la bibliothèque</Link>
            </Button>
          </div>
        </div>
      )}

      {data && data.length > 0 && (
        <>
          <Filters f={f} placeholder="Rechercher un cours…" />
          {f.filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucun cours ne correspond à ta recherche.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {f.filtered.map((c) => (
                <CourseCard key={c.id} c={c} href={`/course/${c.id}`} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function LibraryPage() {
  const { data, isLoading, error } = useQuery<CourseSummary[]>({ queryKey: ["/api/library"] });
  const f = useFiltered(data);
  return (
    <div>
      <div className="mb-8 max-w-2xl">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          <Globe2 className="h-4 w-4" /> Communauté
        </p>
        <h1 className="mt-1 font-display text-xl font-bold">Bibliothèque publique</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Les cours que les utilisateurs ont choisi de publier. Consulte leurs notes, révise leurs fiches et entraîne-toi sur leurs exercices et
          examens.
        </p>
      </div>
      {isLoading && <CourseGridSkeleton />}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {data && data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <BookOpenCheck className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-3 text-base font-semibold">Aucun cours publié pour l'instant</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Ouvre l'un de tes cours et active « Publier dans la bibliothèque » pour le partager.
          </p>
        </div>
      )}
      {data && data.length > 0 && (
        <>
          <Filters f={f} placeholder="Rechercher par titre, matière ou auteur…" />
          {f.filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucun cours ne correspond à ta recherche.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {f.filtered.map((c) => (
                <CourseCard key={c.id} c={c} href={c.isOwner ? `/course/${c.id}` : `/public/${c.id}`} showOwner />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
