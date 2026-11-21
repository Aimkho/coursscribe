import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Loader2, Mic, Pause, Play, Square, Upload, Sparkles, Info, MoonStar } from "lucide-react";
import type { Course } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRecorder, formatDuration } from "@/lib/useRecorder";
import { apiRequest, apiUpload, apiTranscribe, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const autoAnalyze = { id: null as number | null };

const LEVELS = ["Collège", "Lycée", "BTS / BUT", "Licence", "Master", "Prépa / Concours", "Autre"];

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

export default function RecordPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [saving, setSaving] = useState<null | "save" | "analyze">(null);
  const [sensitivity, setSensitivity] = useState(2);
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const followRef = useRef(true);

  const metaRef = useRef({ title: "", subject: "", transcript: "" });
  metaRef.current = { title, subject, transcript };

  const rec = useRecorder({
    transcribe: apiTranscribe,
    getContext: () => {
      const m = metaRef.current;
      return [m.subject, m.title, m.transcript.slice(-150)].filter(Boolean).join(" — ");
    },
    onFinal: (t) =>
      setTranscript((prev) => {
        const sep = prev && !/\s$/.test(prev) ? " " : "";
        const sentence = t.charAt(0).toUpperCase() + t.slice(1);
        return prev + sep + sentence + (/[.!?]$/.test(sentence) ? "" : ".");
      }),
  });

  useEffect(() => {
    rec.setThreshold([0.05, 0.03, 0.018, 0.01][sensitivity]);
  }, [sensitivity]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript, rec.interim, rec.preview]);

  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  const recording = rec.state === "recording";
  const live = recording || rec.state === "paused" || rec.state === "starting";

  async function save(analyze: boolean) {
    if (!title.trim()) {
      toast({ title: "Donne un titre à ton cours", description: "Par exemple : « Chapitre 3 — Le seuil de rentabilité »." });
      return;
    }
    setSaving(analyze ? "analyze" : "save");
    if (live) {
      rec.stop();
      // Attendre la transcription des derniers extraits avant d'enregistrer.
      await rec.waitForPending();
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      const res = await apiRequest("POST", "/api/courses", {
        title,
        subject,
        level,
        transcript: metaRef.current.transcript.trim(),
        durationSec: rec.elapsed,
      });
      const course: Course = await res.json();
      // Attendre que le blob audio soit disponible après l'arrêt.
      let blob = rec.audioBlob;
      for (let i = 0; !blob && live && i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        blob = recBlobRef.current;
      }
      if (blob && blob.size > 0) {
        try {
          await apiUpload(`/api/courses/${course.id}/audio`, blob);
        } catch (e: any) {
          toast({ title: "Audio non sauvegardé", description: e.message, variant: "destructive" });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/courses"] });
      if (analyze) autoAnalyze.id = course.id;
      navigate(`/course/${course.id}`);
    } catch (e: any) {
      toast({ title: "Enregistrement impossible", description: e.message, variant: "destructive" });
      setSaving(null);
    }
  }
  const recBlobRef = useRef<Blob | null>(null);
  recBlobRef.current = rec.audioBlob;

  function importFile(file: File) {
    if (!/\.(txt|md|vtt|srt)$/i.test(file.name) && !file.type.startsWith("text/")) {
      toast({ title: "Format non pris en charge", description: "Importe un fichier texte (.txt, .md, .srt, .vtt)." });
      return;
    }
    file.text().then((t) => {
      const cleaned = t.replace(/^\d+\s*$/gm, "").replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3} --> .*$/gm, "").replace(/\n{2,}/g, "\n").trim();
      setTranscript((p) => (p ? p + "\n\n" : "") + cleaned);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    });
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-xl font-bold">Enregistrer un cours</h1>
        <p className="mt-1 text-sm text-muted-foreground">Démarre au début du cours. Tu peux corriger le texte à tout moment.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Colonne gauche : infos + console */}
        <div className="flex min-w-0 flex-col gap-5">
          <section className="rounded-2xl border border-card-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">Informations du cours</h2>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="title">Titre</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chapitre 3 — Le seuil de rentabilité" data-testid="input-title" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="subject">Matière</Label>
                  <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Gestion" data-testid="input-subject" />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="level">Niveau</Label>
                  <select
                    id="level"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    data-testid="select-level"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Choisir…</option>
                    {LEVELS.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

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
                <Button className="h-12 flex-1 text-base" onClick={rec.start} disabled={rec.state === "starting"} data-testid="button-start">
                  {rec.state === "starting" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Mic className="mr-2 h-5 w-5" />}
                  Démarrer
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
            {rec.micError && (
              <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-mic-error">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {rec.micError}
              </p>
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
            {rec.state === "idle" && (
              <p className="mt-3 flex gap-2 text-xs leading-5 text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Transcription par IA sur ton micro, extrait par extrait (quelques secondes de décalage). Fonctionne sur Chrome, Edge, Firefox et Safari.
              </p>
            )}

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
              <h2 className="text-sm font-semibold">Transcription en direct</h2>
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
              <span className="text-xs tabular-nums text-muted-foreground" data-testid="text-wordcount">
                {words.toLocaleString("fr-FR")} mots
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                <Upload className="h-3.5 w-3.5" /> Importer un texte
                <input type="file" accept=".txt,.md,.srt,.vtt,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} data-testid="input-import" />
              </label>
            </div>
          </div>
          <div className="relative flex min-h-[420px] flex-1 flex-col">
            <Textarea
              ref={transcriptRef}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              onScroll={(e) => {
                const el = e.currentTarget;
                followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
              placeholder={"Le texte du cours apparaîtra ici pendant l'enregistrement.\n\nTu peux aussi coller directement une transcription existante."}
              className="min-h-[360px] flex-1 resize-none rounded-none border-0 px-5 py-4 text-[15px] leading-7 shadow-none focus-visible:ring-0"
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
              {words < 40 ? "Au moins 40 mots sont nécessaires pour l'analyse IA." : "Prêt pour l'analyse : notes, fiche, exercices et examen."}
            </p>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex">
              <Button variant="outline" onClick={() => save(false)} disabled={!!saving || (!transcript.trim() && !rec.elapsed)} data-testid="button-save">
                {saving === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enregistrer
              </Button>
              <Button onClick={() => save(true)} disabled={!!saving || words < 40} data-testid="button-save-analyze">
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
