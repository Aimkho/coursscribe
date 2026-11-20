import { useState } from "react";
import { Loader2, Mic, Sparkles, GraduationCap, Globe2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/AppShell";
import { cn } from "@/lib/utils";

const FEATURES = [
  { icon: Mic, title: "Transcription en direct", text: "Le texte du cours s'écrit pendant que tu écoutes." },
  { icon: Sparkles, title: "L'essentiel, sans le bruit", text: "Notes structurées, définitions et formules — sans les digressions." },
  { icon: GraduationCap, title: "Révise pour de vrai", text: "Fiches, flashcards, exercices corrigés et examens blancs notés." },
  { icon: Globe2, title: "Partage tes cours", text: "Publie un cours pour toute la communauté, ou garde-le privé." },
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") await register(name, email, password);
      else await login(email, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#1A1033] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#7D4FFE] opacity-40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-[#FE277E] opacity-20 blur-3xl" />
        <BrandMark className="relative [&_span:last-child]:text-white" />
        <div className="relative mt-auto max-w-lg">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-[#C49FFF]">Pour élèves et étudiants</p>
          <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.05]">
            Écoute ton cours.
            <br />
            On s'occupe des notes.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-white/75">
            CoursScribe transcrit ton cours en direct, en extrait l'essentiel et le transforme en fiches de révision, exercices et examens
            blancs.
          </p>
          <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-6">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-[#C49FFF]">
                  <f.icon className="h-[18px] w-[18px]" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="mt-1 text-sm leading-snug text-white/65">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <BrandMark className="mb-10 lg:hidden" />
          <h2 className="font-display text-xl font-bold">{mode === "register" ? "Crée ton compte" : "Bon retour"}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "register" ? "Gratuit pour commencer, sans carte bancaire." : "Connecte-toi pour retrouver tes cours."}
          </p>

          <div className="mt-6 grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist">
            {(["register", "login"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                data-testid={`tab-${m}`}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  "rounded-md py-2 text-sm font-medium transition-colors",
                  mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "register" ? "Inscription" : "Connexion"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Prénom et nom</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required data-testid="input-name" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required data-testid="input-email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                minLength={mode === "register" ? 8 : 1}
                data-testid="input-password"
              />
              {mode === "register" && <p className="text-xs text-muted-foreground">8 caractères minimum.</p>}
            </div>
            {error && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-auth-error">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={loading} data-testid="button-submit-auth">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "register" ? "Créer mon compte" : "Se connecter"}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
