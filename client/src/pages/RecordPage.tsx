import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  FileAudio,
  History,
  Info,
  Loader2,
  Mic,
  MoonStar,
  Pause,
  Play,
  Sparkles,
  Square,
  Upload,
} from "lucide-react";
import type { Course, CourseSession, Subject } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseRecordPanel } from "@/components/ClassExercises";
import { useRecorder, formatDuration } from "@/lib/useRecorder";
import { apiRequest, apiUploadSessionAudio, apiTranscribe, apiTranscribeFile, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const autoAnalyze = { id: null as number | null };

const LEVELS = ["Collège", "Lycée", "BTS / BUT", "Licence", "Master", "Prépa / Concours", "Autre"];
const NEW_SUBJECT = "__new__";
const AUTOSAVE_MS = 15000;

export function sessionMarker(idx: number, ts: number) {
  const d = new Date(ts).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `— Séance ${idx} · ${d} —`;
}

/** Texte complet du cours : séances précédentes + séance en cours, séparées par un repère daté. */
function joinTranscript(base: string, sessions: CourseSession[], idx: number, startedAt: number, current: string) {
  const prev = base.trim();
  const cur = current.trim();
  if (!prev) return cur;
  let head = prev;
  if (!/^— Séance \d+/.test(prev) && sessions[0]) head = `${sessionMarker(1, sessions[0].startedAt)}\n${prev}`;
  return cur ? `${head}\n\n${sessionMarker(idx, startedAt)}\n${cur}` : head;
}

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 28;
  return (
    <div className="flex h-10 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const center = 1 - Math.abs(i - bars / 2) / (bars / 2);
        const h = active ? Math.max(0.12, Math.min(1, level * (0.5 + center) * 1.6 + Math.sin(i * 1.7) * 0.05)) : 0.12;
        return (
          <span
            key={i}
            className={cn("w-[4px] rounded-full transition-[height] duration-100", active ? "bg-[#FE277E]" : "bg-border")}
            style={{ height: `${h * 100}%` }}
          />
        );
      })}
    </div>
  );
}

function defaultTitle() {
  return `Cours du ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
}

export default function RecordPage({ continueId, subjectId: presetSubject }: { continueId?: number; subjectId?: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const continuing = !!continueId;

  const { data: subjects } = useQuery<Subject[]>({ queryKey: ["/api/subjects"] });
  const { data: baseCourse, isLoading: loadingBase } = useQuery<Course>({
    queryKey: ["/api/courses", continueId],
    enabled: continuing,
  });

  const [title, setTitle] = useState("");
  const [subjectChoice, setSubjectChoice] = useState<string>(presetSubject ? String(presetSubject) : "");
  const [newSubject, setNewSubject] = useState("");
  const [chapter, setChapter] = useState<string>("");
  const [chapterTouched, setChapterTouched] = useState(false);
  const [level, setLevel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [saving, setSaving] = useState<null | "save" | "analyze">(null);
  const [sensitivity, setSensitivity] = useState(2);
  const [autosave, setAutosave] = useState<{ state: "idle" | "saving" | "saved" | "error"; at?: number }>({ state: "idle" });
  const [importing, setImporting] = useState<null | { name: string; done: number; total: number }>(null);
  const [importedSec, setImportedSec] = useState(0);
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const followRef = useRef(true);
  const importCancel = useRef({ cancelled: false });

  // Identifiants côté serveur (créés à la première sauvegarde)
  const courseIdRef = useRef<number | null>(continueId ?? null);
  const sessionRef = useRef<{ id: number; idx: number; startedAt: number } | null>(null);
  const ensuring = useRef<Promise<void> | null>(null);
  const lastSavedRef = useRef<string>("");

  // Matière présélectionnée (depuis la page d'une matière)
  const selectedSubject = useMemo(
    () => (subjectChoice && subjectChoice !== NEW_SUBJECT ? subjects?.find((s) => String(s.id) === subjectChoice) : undefined),
    [subjects, subjectChoice],
  );
  const subjectName = subjectChoice === NEW_SUBJECT ? newSubject.trim() : selectedSubject?.name || "";

  useEffect(() => {
    if (subjects && !subjectChoice && subjects.length === 0) setSubjectChoice(NEW_SUBJECT);
  }, [subjects]);

  // Numéro de chapitre suggéré
  useEffect(() => {
    if (continuing || chapterTouched) return;
    if (selectedSubject) {
      apiRequest("GET", `/api/subjects/${selectedSubject.id}/next-chapter`)
        .then((r) => r.json())
        .then((d) => setChapter(String(d.next)))
        .catch(() => {});
      if (!level && selectedSubject.level) setLevel(selectedSubject.level);
    } else if (subjectChoice === NEW_SUBJECT) setChapter("1");
    else setChapter("");
  }, [selectedSubject?.id, subjectChoice]);

  const metaRef = useRef({ title: "", subject: "", transcript: "" });
  metaRef.current = { title: title || baseCourse?.title || "", subject: subjectName || baseCourse?.subject || "", transcript };

  const rec = useRecorder({
    transcribe: apiTranscribe,
    getContext: () => {
      const m = metaRef.current;
      return [m.subject, m.title, m.transcript.replace(/\[Exercice \d+ — (?:début|fin)\]/g, " ").slice(-150).trim()].filter(Boolean).join(" — ");
    },
    onFinal: (t) =>
      setTranscript((prev) => {
        const sep = prev && !/\s$/.test(prev) ? " " : "";
        const sentence = t.charAt(0).toUpperCase() + t.slice(1);
        return prev + sep + sentence + (/[.!?]$/.test(sentence) ? "" : ".");
      }),
    onMarker: (m) => setTranscript((p) => (p.trim() ? p.trimEnd() + "\n\n" : "") + m + "\n"),
  });

  useEffect(() => {
    rec.setThreshold([0.05, 0.03, 0.018, 0.01][sensitivity]);
  }, [sensitivity]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript, rec.interim, rec.preview]);

  const words = wordCount(transcript);
  const recording = rec.state === "recording";
  const live = recording || rec.state === "paused" || rec.state === "starting";
  const nextIdx = (baseCourse?.sessions.length ?? 0) + 1;
  const baseWords = baseCourse ? wordCount(baseCourse.transcript) : 0;
  const totalWords = words + baseWords;

  // ---------- Sauvegarde côté serveur ----------
  async function ensureServerObjects() {
    if (sessionRef.current) return;
    if (!ensuring.current)
      ensuring.current = (async () => {
        if (!courseIdRef.current) {
          const res = await apiRequest("POST", "/api/courses", {
            title: title.trim() || defaultTitle(),
            subjectId: selectedSubject?.id ?? null,
            subject: subjectName,
            level,
            chapterNumber: chapter ? Number(chapter) : null,
            transcript: "",
            durationSec: 0,
          });
          const c: Course = await res.json();
          courseIdRef.current = c.id;
        }
        const r = await apiRequest("POST", `/api/courses/${courseIdRef.current}/sessions`);
        const s: CourseSession = await r.json();
        sessionRef.current = { id: s.id, idx: s.idx, startedAt: s.startedAt };
      })().finally(() => {
        ensuring.current = null;
      });
    await ensuring.current;
  }

  function fullTranscript(current: string) {
    const s = sessionRef.current;
    if (!continuing || !baseCourse || !s) return current.trim();
    return joinTranscript(baseCourse.transcript, baseCourse.sessions, s.idx, s.startedAt, current);
  }

  async function saveProgress(force = false) {
    const current = metaRef.current.transcript;
    if (!current.trim() && !force) return;
    const signature = `${current}|${Math.floor((rec.elapsed + importedSec) / 30)}`;
    if (!force && signature === lastSavedRef.current) return;
    setAutosave({ state: "saving" });
    try {
      await ensureServerObjects();
      const s = sessionRef.current!;
      await apiRequest("PUT", `/api/courses/${courseIdRef.current}/sessions/${s.id}`, {
        transcript: fullTranscript(current),
        durationSec: rec.elapsed + importedSec,
        wordCount: wordCount(current),
      });
      lastSavedRef.current = signature;
      setAutosave({ state: "saved", at: Date.now() });
    } catch (e) {
      setAutosave({ state: "error" });
      if (force) throw e;
    }
  }

  // Sauvegarde automatique toutes les 15 s pendant l'enregistrement, et à chaque pause.
  const saveRef = useRef(saveProgress);
  saveRef.current = saveProgress;
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => saveRef.current(false), AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [live]);
  useEffect(() => {
    if (rec.state === "paused" || rec.state === "stopped") saveRef.current(false);
  }, [rec.state]);

  // Avertit avant de quitter si un enregistrement est en cours
  useEffect(() => {
    if (!live) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [live]);

  const recBlobRef = useRef<Blob | null>(null);
  recBlobRef.current = rec.audioBlob;

  async function save(analyze: boolean) {
    if (!continuing && subjectChoice === NEW_SUBJECT && !newSubject.trim() && !title.trim()) {
      toast({ title: "Indique au moins un titre ou une matière", description: "Par exemple : Gestion — Chapitre 3, Le seuil de rentabilité." });
      return;
    }
    setSaving(analyze ? "analyze" : "save");
    if (live) {
      rec.stop();
      await rec.waitForPending();
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      await saveProgress(true);
      const id = courseIdRef.current!;
      if (!continuing) {
        await apiRequest("PATCH", `/api/courses/${id}`, {
          title: title.trim() || defaultTitle(),
          subjectId: selectedSubject?.id ?? null,
          subject: subjectName,
          level,
          chapterNumber: chapter ? Number(chapter) : null,
        });
      }
      let blob = rec.audioBlob;
      for (let i = 0; !blob && rec.elapsed > 0 && i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        blob = recBlobRef.current;
      }
      if (blob && blob.size > 0 && sessionRef.current) {
        try {
          await apiUploadSessionAudio(id, sessionRef.current.id, blob);
        } catch (e: any) {
          toast({ title: "Audio non sauvegardé", description: e.message, variant: "destructive" });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      if (analyze) autoAnalyze.id = id;
      navigate(`/course/${id}`);
    } catch (e: any) {
      toast({ title: "Enregistrement impossible", description: e.message, variant: "destructive" });
      setSaving(null);
    }
  }

  function importFile(file: File) {
    if (!/\.(txt|md|vtt|srt)$/i.test(file.name) && !file.type.startsWith("text/")) {
      toast({ title: "Format non pris en charge", description: "Importe un fichier texte (.txt, .md, .srt, .vtt)." });
      return;
    }
    file.text().then((t) => {
      const cleaned = t.replace(/^\d+\s*$/gm, "").replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3} --> .*$/gm, "").replace(/\n{2,}/g, "\n").trim();
      setTranscript((p) => (p ? p + "\n\n" : "") + cleaned);
      if (!title && !continuing) setTitle(file.name.replace(/\.[^.]+$/, ""));
    });
  }

  async function importAudio(file: File) {
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/") && !/\.(mp3|m4a|wav|webm|ogg|aac|mp4|opus|flac|amr|3gp)$/i.test(file.name)) {
      toast({ title: "Format non pris en charge", description: "Importe un fichier audio : mp3, m4a, wav, webm, ogg…" });
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: "500 Mo maximum." });
      return;
    }
    importCancel.current = { cancelled: false };
    setImporting({ name: file.name, done: 0, total: 0 });
    try {
      const ctx = [metaRef.current.subject, metaRef.current.title].filter(Boolean).join(" — ");
      const r = await apiTranscribeFile(file, ctx, (p) => setImporting({ name: file.name, done: p.done, total: p.total }), importCancel.current);
      if (!r.text.trim()) {
        toast({ title: "Aucune parole détectée", description: "Le fichier semble ne contenir que du silence ou du bruit." });
      } else {
        setTranscript((p) => (p.trim() ? p.trimEnd() + "\n\n" : "") + r.text.trim());
        setImportedSec((s) => s + (r.durationSec || 0));
        if (!title && !continuing) setTitle(file.name.replace(/\.[^.]+$/, ""));
        toast({ title: "Audio transcrit", description: `${wordCount(r.text).toLocaleString("fr-FR")} mots ajoutés (${formatDuration(r.durationSec || 0)}).` });
        setTimeout(() => saveRef.current(false), 100);
      }
    } catch (e: any) {
      if (!importCancel.current.cancelled) toast({ title: "Import impossible", description: e.message, variant: "destructive" });
    } finally {
      setImporting(null);
    }
  }

  async function openInNewTab() {
    // Ouvre l'application en pleine page, hors de la fenêtre intégrée, en gardant la session.
    const w = window.open("", "_blank");
    try {
      const r = await apiRequest("POST", "/api/auth/handoff");
      const { code } = await r.json();
      const base = window.location.href.split("#")[0];
      const route = window.location.hash.replace(/^#/, "").split("?")[0] || "/record";
      const url = `${base}#${route}?handoff=${code}`;
      if (w) w.location.href = url;
      else window.open(url, "_blank");
    } catch {
      if (w) w.location.href = window.location.href;
    }
  }

  if (continuing && loadingBase)
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/60" />
      </div>
    );
  if (continuing && baseCourse && !baseCourse.isOwner)
    return <p className="py-16 text-center text-sm text-muted-foreground">Seul l'auteur du cours peut ajouter une séance.</p>;

  const autosaveLabel =
    autosave.state === "saving"
      ? "Sauvegarde…"
      : autosave.state === "saved"
        ? `Sauvegardé à ${new Date(autosave.at!).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
        : autosave.state === "error"
          ? "Sauvegarde en attente (connexion)"
          : "";

  return (
    <div>
      <div className="mb-8">
        {continuing && baseCourse && (
          <Link href={`/course/${baseCourse.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {baseCourse.title}
          </Link>
        )}
        <h1 className="font-display text-xl font-bold">{continuing ? `Continuer le cours — séance ${nextIdx}` : "Enregistrer un cours"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {continuing
            ? "La suite du cours s'ajoute au texte des séances précédentes, avec la date de la séance."
            : "Démarre au début du cours. Tu peux corriger le texte à tout moment. La progression est sauvegardée automatiquement."}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Colonne gauche : infos + console */}
        <div className="flex min-w-0 flex-col gap-5">
          {continuing && baseCourse ? (
            <section className="rounded-2xl border border-card-border bg-card p-5" data-testid="card-continue-info">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {baseCourse.subject || "Sans matière"}
                {baseCourse.chapterNumber ? ` · Chapitre ${baseCourse.chapterNumber}` : ""}
              </p>
              <h2 className="mt-1.5 text-base font-semibold leading-snug">{baseCourse.title}</h2>
              <ul className="mt-4 space-y-2 border-t border-border pt-3">
                {baseCourse.sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      Séance {s.idx} · {new Date(s.startedAt).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">{formatDuration(s.durationSec)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", recording ? "bg-[#FE277E]" : "bg-primary/40")} />
                    Séance {nextIdx} · aujourd'hui
                  </span>
                  <span className="tabular-nums text-xs">{formatDuration(rec.elapsed + importedSec)}</span>
                </li>
              </ul>
            </section>
          ) : (
            <section className="rounded-2xl border border-card-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold">Informations du cours</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="subject">Matière</Label>
                    <select
                      id="subject"
                      value={subjectChoice}
                      onChange={(e) => {
                        setSubjectChoice(e.target.value);
                        setChapterTouched(false);
                      }}
                      data-testid="select-subject"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-base md:h-9 md:text-sm"
                    >
                      <option value="">Sans matière</option>
                      {(subjects || []).map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name} ({s.chapterCount} chap.)
                        </option>
                      ))}
                      <option value={NEW_SUBJECT}>+ Nouvelle matière…</option>
                    </select>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="chapter">Chapitre</Label>
                    <Input
                      id="chapter"
                      inputMode="numeric"
                      value={chapter}
                      onChange={(e) => {
                        setChapter(e.target.value.replace(/\D/g, "").slice(0, 3));
                        setChapterTouched(true);
                      }}
                      placeholder="n°"
                      data-testid="input-chapter"
                    />
                  </div>
                </div>
                {subjectChoice === NEW_SUBJECT && (
                  <div className="space-y-1.5">
                    <Label htmlFor="newsubject">Nom de la matière</Label>
                    <Input
                      id="newsubject"
                      value={newSubject}
                      onChange={(e) => setNewSubject(e.target.value)}
                      placeholder="Contrôle de gestion"
                      data-testid="input-subject"
                      autoFocus={!!subjects?.length}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="title">Titre du chapitre</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Le seuil de rentabilité" data-testid="input-title" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="level">Niveau</Label>
                  <select
                    id="level"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    data-testid="select-level"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-base md:h-9 md:text-sm"
                  >
                    <option value="">Choisir…</option>
                    {LEVELS.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>
          )}

          <section className={cn("rounded-2xl border p-5 transition-colors", recording ? "border-[#FE277E]/40 bg-[#FE277E]/[0.03]" : "border-card-border bg-card")}>
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold",
                  recording && "bg-[#FE277E] text-white",
                  rec.state === "paused" && "bg-secondary text-secondary-foreground",
                  (rec.state === "idle" || rec.state === "stopped" || rec.state === "starting") && "bg-muted text-muted-foreground",
                )}
                data-testid="status-recording"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", recording ? "bg-white" : "bg-current")} />
                {rec.state === "idle" && "Prêt"}
                {rec.state === "starting" && "Accès au micro…"}
                {recording && "Enregistrement"}
                {rec.state === "paused" && (rec.pauseReason === "inactivity" ? "Pause auto" : "En pause")}
                {rec.state === "stopped" && "Terminé"}
              </span>
              <span className="font-display text-2xl font-bold tabular-nums" data-testid="text-timer">
                {formatDuration(rec.elapsed)}
              </span>
            </div>

            <div className="my-5">
              <LevelMeter level={rec.level} active={recording} />
            </div>

            <div className="flex gap-2">
              {(rec.state === "idle" || rec.state === "starting") && (
                <Button className="h-12 flex-1 text-base" onClick={rec.start} disabled={rec.state === "starting" || !!importing} data-testid="button-start">
                  {rec.state === "starting" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Mic className="mr-2 h-5 w-5" />}
                  {continuing ? `Démarrer la séance ${nextIdx}` : "Démarrer"}
                </Button>
              )}
              {recording && (
                <Button variant="secondary" className="h-12 flex-1" onClick={rec.pause} data-testid="button-pause">
                  <Pause className="mr-2 h-4 w-4" /> Pause
                </Button>
              )}
              {rec.state === "paused" && (
                <Button className="rec-pulse h-12 flex-1 bg-[#FE277E] hover:bg-[#e8206f]" onClick={rec.resume} data-testid="button-resume">
                  <Play className="mr-2 h-4 w-4" /> Reprendre
                </Button>
              )}
              {live && rec.state !== "starting" && (
                <Button className="h-12 bg-[#8A0D1E] px-5 text-white hover:bg-[#740b19]" onClick={rec.stop} data-testid="button-stop">
                  <Square className="mr-2 h-4 w-4 fill-current" /> Arrêter
                </Button>
              )}
              {rec.state === "stopped" && (
                <div className="flex-1 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                  Enregistrement terminé ({formatDuration(rec.elapsed)}). Micro libéré.
                </div>
              )}
            </div>

            {rec.state === "paused" && rec.pauseReason === "inactivity" && (
              <p className="mt-3 flex gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground" data-testid="text-auto-pause">
                <MoonStar className="mt-0.5 h-4 w-4 shrink-0" />
                Aucune activité depuis 5 minutes : l'enregistrement est en pause. Clique sur Reprendre quand le cours repart.
              </p>
            )}
            {recording && rec.silenceLeft < 60000 && (
              <p className="mt-3 text-xs text-muted-foreground">Pause automatique dans {Math.ceil(rec.silenceLeft / 1000)} s sans son détecté.</p>
            )}

            {rec.micBlocked === "frame" ? (
              <div role="alert" className="mt-3 rounded-xl border border-[#7D4FFE]/30 bg-[#7D4FFE]/[0.05] p-3.5" data-testid="panel-mic-blocked">
                <p className="flex gap-2 text-sm font-semibold text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FE277E]" /> Micro bloqué dans cette fenêtre
                </p>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  L'aperçu intégré empêche l'accès au micro. Ouvre CoursScribe dans un onglet à part : ta session est conservée, il suffira
                  d'autoriser le micro.
                </p>
                <Button className="mt-3 w-full" onClick={openInNewTab} data-testid="button-open-tab">
                  <ExternalLink className="mr-2 h-4 w-4" /> Ouvrir en pleine page
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">Autre solution : enregistre avec ton téléphone puis importe le fichier audio ci-dessous.</p>
              </div>
            ) : (
              rec.micError && (
                <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-mic-error">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {rec.micError}
                </p>
              )
            )}
            {rec.speechError && live && (
              <p className="mt-3 flex gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="text-speech-error">
                <Info className="mt-0.5 h-4 w-4 shrink-0" /> {rec.speechError}
              </p>
            )}
            {rec.sttStatus === "error" && live && (
              <p className="mt-3 flex gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="text-stt-error">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                Un extrait n'a pas pu être transcrit (connexion). L'enregistrement continue et l'audio complet est conservé.
              </p>
            )}
            {rec.state === "idle" && !rec.micBlocked && (
              <p className="mt-3 flex gap-2 text-xs leading-5 text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Transcription par IA sur ton micro, extrait par extrait (quelques secondes de décalage). Fonctionne sur Chrome, Edge, Firefox et Safari.
                <span className="lg:hidden"> Sur téléphone ou tablette, garde CoursScribe ouvert au premier plan : l'écran reste allumé pendant l'enregistrement.</span>
              </p>
            )}

            {/* Import d'un enregistrement audio */}
            <div className="mt-4">
              {importing ? (
                <div className="rounded-lg border border-border px-3 py-2.5" data-testid="status-import-audio">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      <span className="truncate">{importing.name}</span>
                    </span>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        importCancel.current.cancelled = true;
                        setImporting(null);
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${importing.total ? Math.max(4, (importing.done / importing.total) * 100) : 4}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {importing.total ? `Transcription : ${importing.done} / ${importing.total} extraits` : "Préparation du fichier…"}
                  </p>
                </div>
              ) : (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm hover:border-primary/40 hover:bg-muted/50",
                    live && "pointer-events-none opacity-50",
                  )}
                >
                  <FileAudio className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="font-medium">Importer un enregistrement audio</span>
                    <span className="block text-xs text-muted-foreground">mp3, m4a, wav, webm… depuis ton téléphone ou dictaphone</span>
                  </span>
                  <input
                    type="file"
                    accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm,.ogg,.aac,.opus,.amr,.3gp"
                    className="sr-only"
                    disabled={live}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) importAudio(f);
                    }}
                    data-testid="input-import-audio"
                  />
                </label>
              )}
            </div>

            <ExerciseRecordPanel
              text={(baseCourse?.transcript ?? "") + "\n" + transcript}
              live={live}
              onMarker={(m) => {
                if (recording) rec.insertMarker(m);
                else setTranscript((p) => (p.trim() ? p.trimEnd() + "\n\n" : "") + m + "\n");
              }}
              ensureCourse={async () => {
                await ensureServerObjects();
                return { courseId: courseIdRef.current!, sessionId: sessionRef.current?.id ?? null };
              }}
            />

            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="sens" className="text-xs text-muted-foreground">
                  Sensibilité de détection du son
                </Label>
                <span className="text-xs font-medium">{["Faible", "Moyenne", "Élevée", "Très élevée"][sensitivity]}</span>
              </div>
              <input
                id="sens"
                type="range"
                min={0}
                max={3}
                step={1}
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
                className="mt-2 w-full accent-[#7D4FFE]"
                data-testid="slider-sensitivity"
              />
              <p className="mt-1 text-xs text-muted-foreground">Baisse-la si un bruit de fond empêche la pause automatique.</p>
            </div>
          </section>
        </div>

        {/* Colonne droite : transcription */}
        <section className="flex min-w-0 flex-col rounded-2xl border border-card-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{continuing ? `Séance ${nextIdx} — transcription en direct` : "Transcription en direct"}</h2>
              {recording && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C3155D]" data-testid="status-listening">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FE277E]" /> à l'écoute
                </span>
              )}
              {rec.pendingCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary" data-testid="status-transcribing">
                  <Loader2 className="h-3 w-3 animate-spin" /> transcription…
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {autosaveLabel && (
                <span
                  className={cn("inline-flex items-center gap-1 text-xs", autosave.state === "error" ? "text-[#C3155D]" : "text-muted-foreground")}
                  data-testid="status-autosave"
                >
                  <CloudUpload className="h-3.5 w-3.5" /> {autosaveLabel}
                </span>
              )}
              <span className="text-xs tabular-nums text-muted-foreground" data-testid="text-wordcount">
                {words.toLocaleString("fr-FR")} mots
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                <Upload className="h-3.5 w-3.5" /> Importer un texte
                <input type="file" accept=".txt,.md,.srt,.vtt,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} data-testid="input-import" />
              </label>
            </div>
          </div>
          {continuing && baseCourse && baseCourse.transcript.trim() && (
            <details className="group border-b border-border px-5 py-3" data-testid="details-previous">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                <History className="h-3.5 w-3.5" />
                Séances précédentes · {baseWords.toLocaleString("fr-FR")} mots
                <span className="ml-auto text-[11px] group-open:hidden">Afficher</span>
                <span className="ml-auto hidden text-[11px] group-open:inline">Masquer</span>
              </summary>
              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line text-sm leading-6 text-muted-foreground">{baseCourse.transcript}</p>
            </details>
          )}
          <div className="relative flex min-h-[420px] flex-1 flex-col">
            <Textarea
              ref={transcriptRef}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              onScroll={(e) => {
                const el = e.currentTarget;
                followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
              placeholder={
                continuing
                  ? "La suite du cours apparaîtra ici pendant l'enregistrement."
                  : "Le texte du cours apparaîtra ici pendant l'enregistrement.\n\nTu peux aussi coller directement une transcription existante."
              }
              className="min-h-[360px] flex-1 resize-none rounded-none border-0 px-5 py-4 text-base leading-7 shadow-none focus-visible:ring-0 md:text-[15px]"
              data-testid="textarea-transcript"
            />
            {(rec.pendingPreview || rec.preview || rec.interim) && (
              <div className="border-t border-dashed border-border px-5 py-3" data-testid="text-interim">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">Aperçu instantané</p>
                <p className="text-[15px] italic leading-7 text-muted-foreground">
                  {[rec.pendingPreview, rec.preview, rec.interim].filter(Boolean).join(" ")}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {totalWords < 40
                ? "Au moins 40 mots sont nécessaires pour l'analyse IA."
                : continuing
                  ? "L'analyse portera sur toutes les séances du cours."
                  : "Prêt pour l'analyse : notes, fiche, exercices et examen."}
            </p>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex">
              <Button variant="outline" onClick={() => save(false)} disabled={!!saving || !!importing || (!transcript.trim() && !rec.elapsed)} data-testid="button-save">
                {saving === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enregistrer
              </Button>
              <Button onClick={() => save(true)} disabled={!!saving || !!importing || totalWords < 40 || !transcript.trim()} data-testid="button-save-analyze">
                {saving === "analyze" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                <span className="sm:hidden">Analyser</span>
                <span className="hidden sm:inline">Enregistrer et analyser</span>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
