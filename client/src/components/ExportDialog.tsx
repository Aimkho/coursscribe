import { useState } from "react";
import { Download, FileText, FileType2, Loader2, Presentation, Check } from "lucide-react";
import type { Course } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiDownload } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Format = "pdf" | "docx" | "pptx";
type Part = "notes" | "sheet" | "exercises" | "exam";

const FORMATS: { id: Format; label: string; hint: string; icon: typeof FileText; ext: string }[] = [
  { id: "pdf", label: "PDF", hint: "Mise en page soignée, prête à imprimer", icon: FileText, ext: "pdf" },
  { id: "docx", label: "Word", hint: "Document modifiable (.docx)", icon: FileType2, ext: "docx" },
  { id: "pptx", label: "PowerPoint", hint: "Présentation du cours + quiz", icon: Presentation, ext: "pptx" },
];

const PARTS: { id: Part; label: string }[] = [
  { id: "notes", label: "Notes de cours" },
  { id: "sheet", label: "Fiche de révision" },
  { id: "exercises", label: "Exercices" },
  { id: "exam", label: "Examen blanc" },
];

export function ExportDialog({ course }: { course: Course }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("pdf");
  const available: Record<Part, boolean> = {
    notes: !!course.notes,
    sheet: !!course.sheet,
    exercises: !!course.exercises?.items?.length,
    exam: !!course.exam?.sections?.length,
  };
  const [parts, setParts] = useState<Part[]>(PARTS.map((p) => p.id));
  const [answers, setAnswers] = useState(true);
  const [busy, setBusy] = useState(false);

  const chosen = parts.filter((p) => available[p]);
  const nothing = format === "pptx" ? !available.notes : chosen.length === 0;

  async function download() {
    setBusy(true);
    try {
      const f = FORMATS.find((x) => x.id === format)!;
      const q = format === "pptx" ? "" : `?parts=${chosen.join(",")}&answers=${answers ? 1 : 0}`;
      await apiDownload(`/api/courses/${course.id}/export/${format}${q}`, `cours.${f.ext}`);
      toast({ title: `${f.label} prêt`, description: "Le téléchargement a démarré." });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Export impossible", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2" data-testid="button-export">
          <Download className="h-4 w-4" /> Exporter
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Exporter le cours</DialogTitle>
          <DialogDescription>Choisis un format et le contenu à inclure.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => {
            const active = format === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFormat(f.id)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors",
                  active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted",
                )}
                data-testid={`format-${f.id}`}
              >
                <span className={cn("grid h-8 w-8 place-items-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  <f.icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">{f.label}</span>
                <span className="text-xs leading-4 text-muted-foreground">{f.hint}</span>
              </button>
            );
          })}
        </div>

        {format === "pptx" ? (
          <div className="rounded-xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
            La présentation reprend le plan du cours, les définitions, les formules, les exemples, l'essentiel de la fiche, les pièges à éviter et un quiz
            avec les réponses (aussi dans les notes de l'orateur).
            {!available.notes && <p className="mt-2 font-medium text-destructive">Génère d'abord les notes du cours.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium">Contenu</p>
            <div className="grid grid-cols-2 gap-2">
              {PARTS.map((p) => {
                const ok = available[p.id];
                const on = ok && parts.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!ok}
                    onClick={() => setParts((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      on ? "border-primary/40 bg-primary/5" : "border-border",
                      ok ? "hover:bg-muted" : "cursor-not-allowed opacity-50",
                    )}
                    aria-pressed={on}
                    data-testid={`part-${p.id}`}
                  >
                    <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      {p.label}
                      {!ok && <span className="block text-xs text-muted-foreground">Pas encore généré</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span className="text-sm">
                Inclure les corrigés
                <span className="block text-xs text-muted-foreground">Désactive pour imprimer un sujet d'entraînement</span>
              </span>
              <Switch checked={answers} onCheckedChange={setAnswers} data-testid="switch-answers" />
            </label>
          </div>
        )}

        <Button onClick={download} disabled={busy || nothing} className="h-11 w-full" data-testid="button-download-export">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Télécharger le {FORMATS.find((f) => f.id === format)!.label}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
