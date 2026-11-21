import { useState } from "react";
import { AudioLines, Database, Loader2, ShieldCheck, Trash2, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BrandMark } from "@/components/AppShell";
import { cn } from "@/lib/utils";

/** Ce que l'utilisateur doit savoir avant que l'IA traite ses cours. Réutilisé sur la page Confidentialité. */
export const DATA_FACTS = [
  {
    icon: AudioLines,
    title: "Ce qui est envoyé à l'IA",
    text: "Le son capté par le micro pendant l'enregistrement, les fichiers audio que tu importes, et le texte du cours quand tu génères notes, fiches, exercices ou examens. Rien n'est envoyé tant que tu n'as pas lancé une de ces actions.",
  },
  {
    icon: Sparkles,
    title: "Qui le traite",
    text: "Google Gemini, en offre payante. Dans ce cadre, Google n'utilise ni tes extraits audio ni tes textes pour entraîner ou améliorer ses modèles ; il les conserve seulement un temps limité pour détecter les abus.",
  },
  {
    icon: Database,
    title: "Où tes cours sont stockés",
    text: "Compte, transcriptions, fiches et audio des séances sont enregistrés chez Supabase, dans un centre de données de l'Union européenne (Francfort). Un fichier importé est effacé chez Google dès la fin de sa transcription.",
  },
  {
    icon: Trash2,
    title: "Tes droits",
    text: "Tu peux retirer ton accord, télécharger toutes tes données ou supprimer ton compte à tout moment depuis la page Confidentialité. Un cours supprimé l'est aussi avec son audio.",
  },
];

const CHECKS = [
  { key: "ai", label: "J'accepte que l'audio et le texte de mes cours soient envoyés à Google Gemini pour la transcription et la création des fiches de révision." },
  { key: "age", label: "J'ai 18 ans ou plus." },
  { key: "recording", label: "Je demande l'accord de l'enseignant avant d'enregistrer un cours, et je n'enregistre pas les autres élèves à leur insu." },
] as const;

type Key = (typeof CHECKS)[number]["key"];

export default function ConsentPage() {
  const { user, setUser, logout } = useAuth();
  const [checked, setChecked] = useState<Record<Key, boolean>>({ ai: false, age: false, recording: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = CHECKS.every((c) => checked[c.key]);

  async function accept() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiRequest("POST", "/api/consent", checked);
      setUser(await r.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
        <BrandMark />
        <button onClick={logout} className="text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="button-consent-logout">
          Se déconnecter
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#7D4FFE] text-white">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#7D4FFE]">Avant ton premier cours</p>
            <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight sm:text-3xl" data-testid="text-consent-title">
              {user?.name ? `${user.name.split(" ")[0]}, voici ce que l'IA reçoit de tes cours` : "Voici ce que l'IA reçoit de tes cours"}
            </h1>
          </div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {DATA_FACTS.map((f, i) => (
            <section key={f.title} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-lg",
                    i === 0 && "bg-[#7D4FFE]/10 text-[#7D4FFE]",
                    i === 1 && "bg-[#FE277E]/10 text-[#FE277E]",
                    i === 2 && "bg-[#C49FFF]/25 text-[#5B32D6]",
                    i === 3 && "bg-[#8A0D1E]/10 text-[#8A0D1E]",
                  )}
                >
                  <f.icon className="h-4 w-4" />
                </span>
                <h2 className="font-display text-base font-bold">{f.title}</h2>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
            </section>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-[#7D4FFE]/30 bg-[#7D4FFE]/[0.04] p-4 sm:p-5">
          <ul className="space-y-3.5">
            {CHECKS.map((c) => (
              <li key={c.key}>
                <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
                  <Checkbox
                    checked={checked[c.key]}
                    onCheckedChange={(v) => setChecked((p) => ({ ...p, [c.key]: v === true }))}
                    className="mt-0.5 h-5 w-5"
                    data-testid={`checkbox-consent-${c.key}`}
                  />
                  <span>{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button onClick={accept} disabled={!all || loading} className="h-11 sm:px-6" data-testid="button-consent-accept">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Accepter et commencer
            </Button>
            <p className="text-xs text-muted-foreground">Coche les trois cases pour activer l'enregistrement et l'IA. Tu pourras changer d'avis à tout moment.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
