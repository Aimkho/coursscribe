import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Globe2, Mic, Search, BookOpenCheck, Plus, ChevronRight, Layers, LayoutGrid } from "lucide-react";
import type { CourseSummary, Subject } from "@shared/schema";
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

function SubjectGroups({ list, subjects }: { list: CourseSummary[]; subjects: Subject[] | undefined }) {
  const groups = useMemo(() => {
    const map = new Map<string, { id: number | null; name: string; level: string; items: CourseSummary[]; last: number }>();
    for (const c of list) {
      const key = c.subjectId ? String(c.subjectId) : "none";
      const meta = subjects?.find((s) => s.id === c.subjectId);
      if (!map.has(key)) map.set(key, { id: c.subjectId, name: meta?.name || c.subject || "Sans matière", level: meta?.level || "", items: [], last: 0 });
      const g = map.get(key)!;
      g.items.push(c);
      g.last = Math.max(g.last, c.updatedAt || c.createdAt);
    }
    const arr = Array.from(map.values());
    arr.forEach((g) => g.items.sort((a, b) => (a.chapterNumber ?? 1e9) - (b.chapterNumber ?? 1e9) || a.createdAt - b.createdAt));
    return arr.sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.last - a.last));
  }, [list, subjects]);

  return (
    <div className="space-y-10">
      {groups.map((g) => (
        <section key={g.id ?? "none"} data-testid={`group-subject-${g.id ?? "none"}`}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
            <div className="min-w-0">
              {g.id ? (
                <Link href={`/subject/${g.id}`} className="group inline-flex items-center gap-1.5" data-testid={`link-subject-${g.id}`}>
                  <h2 className="truncate font-display text-lg font-bold group-hover:text-primary">{g.name}</h2>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </Link>
              ) : (
                <h2 className="font-display text-lg font-bold text-muted-foreground">Sans matière</h2>
              )}
              <p className="text-xs text-muted-foreground">
                {g.items.length} {g.items.length > 1 ? "chapitres" : "chapitre"}
                {g.level ? ` · ${g.level}` : ""}
                {" · "}
                {g.items.filter((c) => c.status === "termine").length} terminé{g.items.filter((c) => c.status === "termine").length > 1 ? "s" : ""}
              </p>
            </div>
            {g.id && (
              <Button asChild variant="outline" size="sm" data-testid={`button-new-chapter-${g.id}`}>
                <Link href={`/record/subject/${g.id}`}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Nouveau chapitre
                </Link>
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((c) => (
              <CourseCard key={c.id} c={c} href={`/course/${c.id}`} hideSubject={!!g.id} />
            ))}
          </div>
        </section>
      ))}
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
  const { data: subjects } = useQuery<Subject[]>({ queryKey: ["/api/subjects"] });
  const [view, setView] = useState<"subjects" | "all">("subjects");
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
          <Stat label="Matières · chapitres" value={`${new Set(data.map((c) => c.subjectId ?? 0)).size} · ${data.length}`} />
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
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              {view === "all" ? (
                <Filters f={f} placeholder="Rechercher un cours…" />
              ) : (
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder="Rechercher un chapitre…" className="pl-9" data-testid="input-search" />
                </div>
              )}
            </div>
            <div className="inline-flex shrink-0 self-start rounded-lg border border-border bg-card p-0.5" role="tablist" aria-label="Affichage">
              {([
                ["subjects", "Par matière", Layers],
                ["all", "Tous les cours", LayoutGrid],
              ] as const).map(([v, label, Icon]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => {
                    setView(v);
                    f.setSubject("Toutes");
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`view-${v}`}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>
          {f.filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucun cours ne correspond à ta recherche.</p>
          ) : view === "subjects" ? (
            <SubjectGroups list={f.filtered} subjects={subjects} />
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
