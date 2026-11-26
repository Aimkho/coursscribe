import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { extractDocument, type DocProgress } from "@/lib/docImport";
import { useToast } from "@/hooks/use-toast";

export type ImportedDoc = { label: string; text: string; pages: number; scanned: number };
export type DocImportState = null | ({ name: string; index: number; count: number } & DocProgress);

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
export const docLabel = (name: string) => name.replace(/\.[^.]+$/, "");
export const docBlock = (d: ImportedDoc) => `[Document : ${d.label}]\n${d.text.trim()}`;

/**
 * Importe plusieurs documents à la suite (PDF, Word, PowerPoint, photos).
 * `existing` : texte déjà présent dans le cours, pour ne pas ajouter deux fois le même document.
 */
export function useDocImport() {
  const { toast } = useToast();
  const [state, setState] = useState<DocImportState>(null);
  const cancel = useRef({ cancelled: false });

  async function run(files: File[], hint: string, existing: string): Promise<{ docs: ImportedDoc[]; note: string }> {
    cancel.current = { cancelled: false };
    const out: ImportedDoc[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];
    const list = files.slice(0, 20);
    if (files.length > 20) toast({ title: "20 documents maximum à la fois", description: "Les suivants n'ont pas été importés : relance l'import pour les ajouter." });
    try {
      for (let i = 0; i < list.length; i++) {
        if (cancel.current.cancelled) break;
        const f = list[i];
        const label = docLabel(f.name);
        if (existing.includes(`[Document : ${label}]`) || out.some((d) => d.label === label)) {
          skipped.push(f.name);
          continue;
        }
        setState({ name: f.name, index: i + 1, count: list.length, step: "Ouverture du fichier…", done: 0, total: 0 });
        try {
          const r = await extractDocument(f, hint, (p) => setState({ name: f.name, index: i + 1, count: list.length, ...p }), cancel.current);
          if (cancel.current.cancelled) break;
          if (words(r.text) < 5) failed.push(`${f.name} (aucun texte trouvé)`);
          else out.push({ label, text: r.text, pages: r.pages, scanned: r.scanned });
        } catch (e: any) {
          if (cancel.current.cancelled) break;
          failed.push(`${f.name} : ${e.message}`);
        }
      }
    } finally {
      setState(null);
    }
    if (cancel.current.cancelled) return { docs: out, note: "" };
    const note = [
      skipped.length ? `Déjà dans le cours, non réimporté : ${skipped.join(", ")}.` : "",
      failed.length ? `Non importé : ${failed.join(" · ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    // Sans document importé, l'appelant n'affiche rien : on prévient ici.
    if (!out.length && note) toast({ title: failed.length ? "Import impossible" : "Rien de nouveau à importer", description: note, variant: failed.length ? "destructive" : "default" });
    return { docs: out, note };
  }

  return {
    state,
    run,
    cancel: () => {
      cancel.current.cancelled = true;
      setState(null);
    },
  };
}

export function summarizeDocs(docs: ImportedDoc[]) {
  const n = docs.reduce((s, d) => s + words(d.text), 0);
  const pages = docs.reduce((s, d) => s + d.pages, 0);
  const scanned = docs.reduce((s, d) => s + d.scanned, 0);
  const head = docs.length > 1 ? `${docs.length} documents` : `« ${docs[0].label} »`;
  return `${head} : ${n.toLocaleString("fr-FR")} mots ajoutés${pages > docs.length ? ` (${pages} pages${scanned ? `, dont ${scanned} lues par l'IA` : ""})` : ""}.`;
}

export function DocImportProgress({ state, onCancel }: { state: NonNullable<DocImportState>; onCancel: () => void }) {
  const frac = state.total ? state.done / state.total : 0;
  const overall = ((state.index - 1 + frac) / state.count) * 100;
  return (
    <div className="rounded-lg border border-border px-3 py-2.5" data-testid="status-import-doc">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span className="truncate">
            {state.count > 1 ? `${state.index} / ${state.count} · ` : ""}
            {state.name}
          </span>
        </span>
        <button className="shrink-0 text-xs text-muted-foreground hover:text-foreground" onClick={onCancel} data-testid="button-cancel-doc">
          Annuler
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(4, overall)}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {state.step}
        {state.total > 1 ? ` ${state.done} / ${state.total}` : ""}
      </p>
    </div>
  );
}
