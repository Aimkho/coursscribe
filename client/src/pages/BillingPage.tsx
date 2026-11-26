import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CalendarClock, Check, Crown, ExternalLink, Infinity as InfinityIcon, Loader2, Mic, Repeat, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type PlanId = "free" | "week" | "month" | "year";
export type Billing = {
  plan: PlanId;
  exempt: boolean;
  status: string | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  window: { start: number; end: number };
  usage: { audioSec: number; gens: number };
  limits: { audioSec: number; gens: number } | null;
  base: { audioSec: number; gens: number } | null;
  carry: { audioSec: number; gens: number };
  plans: Record<PlanId, { label: string; price: string; audioSec: number; gens: number; window: string }>;
  checkout: Record<"week" | "month" | "year", string>;
  portal: string;
};

const fmtDate = (t: number) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const hours = (s: number) => {
  const h = s / 3600;
  return h >= 10 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1).replace(".", ",")} h` : `${Math.round(s / 60)} min`;
};

function Meter({ icon: Icon, label, used, max, carry, fmt }: { icon: any; label: string; used: number; max: number; carry: number; fmt: (n: number) => string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Icon className="h-4 w-4 text-primary" /> {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {fmt(used)} / {fmt(max)}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", pct >= 90 ? "bg-[#FE277E]" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Il te reste <strong className="text-foreground">{fmt(Math.max(0, max - used))}</strong>
        {carry > 0 && <> · dont {fmt(carry)} reporté{carry > 1 ? "s" : ""} de la période précédente</>}
      </p>
    </div>
  );
}

const OFFERS: { id: "week" | "month" | "year"; note: string; highlight?: boolean }[] = [
  { id: "week", note: "Pour une semaine de partiels ou un rattrapage." },
  { id: "month", note: "Le plus simple pour suivre tous tes cours.", highlight: true },
  { id: "year", note: "Environ 5,83 € par mois, soit 2 mois offerts." },
];

export default function BillingPage() {
  const [, navigate] = useLocation();
  const justPaid = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("abonnement") === "ok";
  const [waiting, setWaiting] = useState(justPaid);
  const { data, isLoading } = useQuery<Billing>({ queryKey: ["/api/billing"], staleTime: 0, refetchOnMount: "always" });

  // Après paiement : Stripe prévient le serveur en quelques secondes, on attend l'activation.
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const id = window.setInterval(async () => {
      n++;
      await queryClient.fetchQuery({ queryKey: ["/api/billing?fresh=1"], staleTime: 0 }).then((b: any) => {
        queryClient.setQueryData(["/api/billing"], b);
        if (b.plan !== "free" || n > 20) {
          setWaiting(false);
          window.history.replaceState(null, "", window.location.pathname + window.location.hash);
        }
      }).catch(() => {});
    }, 3000);
    return () => window.clearInterval(id);
  }, [waiting]);

  if (isLoading || !data)
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );

  const paid = data.plan !== "free";
  return (
    <div className="space-y-8" data-testid="page-billing">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Abonnement</h1>
        <p className="mt-1 text-sm text-muted-foreground">Paiement sécurisé par Stripe. Sans engagement, résiliable à tout moment.</p>
      </header>

      {waiting && (
        <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-secondary/40 p-4 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Paiement reçu, activation de ton abonnement…
        </div>
      )}

      <section className="rounded-2xl border border-card-border bg-card p-5 sm:p-6" data-testid="card-current-plan">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Ton offre</p>
            <p className="mt-1 flex items-center gap-2 font-display text-xl font-bold">
              {data.exempt ? (
                <>
                  <InfinityIcon className="h-5 w-5 text-primary" /> Accès illimité
                </>
              ) : (
                <>
                  {paid && <Crown className="h-5 w-5 text-[#FE277E]" />} {data.plans[data.plan].label}
                  {paid && <span className="text-base font-medium text-muted-foreground">· {data.plans[data.plan].price}</span>}
                </>
              )}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.exempt
                ? "Compte créateur : aucune limite et aucun abonnement requis."
                : paid && data.periodEnd
                  ? data.cancelAtPeriodEnd
                    ? `Résilié : reste actif jusqu'au ${fmtDate(data.periodEnd)}.`
                    : `Renouvellement le ${fmtDate(data.periodEnd)} : ce que tu n'as pas utilisé sera reporté.`
                  : `Nouvelle période le ${fmtDate(data.window.end)} : ce que tu n'as pas utilisé sera reporté.`}
              {data.status === "past_due" && " Le dernier paiement a échoué : mets à jour ta carte."}
            </p>
          </div>
          {paid && !data.exempt && (
            <Button variant="outline" asChild data-testid="button-portal">
              <a href={data.portal} target="_blank" rel="noopener noreferrer">
                Gérer ou résilier <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
        {data.limits && (
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <Meter icon={Mic} label="Transcription" used={data.usage.audioSec} max={data.limits.audioSec} carry={data.carry.audioSec} fmt={hours} />
            <Meter icon={Wand2} label="Générations IA" used={data.usage.gens} max={data.limits.gens} carry={data.carry.gens} fmt={(n) => String(n)} />
          </div>
        )}
        {data.exempt && (
          <p className="mt-5 text-sm text-muted-foreground">
            Utilisation sur la période : {hours(data.usage.audioSec)} transcrites, {data.usage.gens} générations IA.
          </p>
        )}
      </section>

      {!data.exempt && <HowLimitsWork data={data} />}

      {!data.exempt && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">{paid ? "Changer d'offre" : "Passer à Premium"}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {OFFERS.map((o) => {
              const p = data.plans[o.id];
              const current = data.plan === o.id;
              return (
                <article
                  key={o.id}
                  className={cn(
                    "relative flex flex-col rounded-2xl border bg-card p-5",
                    o.highlight ? "border-primary shadow-[0_0_0_1px_#7D4FFE]" : "border-card-border",
                  )}
                  data-testid={`plan-${o.id}`}
                >
                  {o.highlight && (
                    <span className="absolute -top-3 left-5 rounded-full bg-[#FE277E] px-2.5 py-0.5 text-xs font-semibold text-white">Le plus choisi</span>
                  )}
                  <p className="text-sm font-semibold text-primary">{p.label}</p>
                  <p className="mt-2 font-display text-2xl font-bold">{p.price}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{o.note}</p>
                  <ul className="mt-4 flex-1 space-y-2 text-sm">
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {Math.round(p.audioSec / 3600)} h de transcription {p.window}
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {p.gens} générations IA {p.window}
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Non utilisé : reporté sur la {o.id === "week" ? "semaine" : "période"} suivante
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Exercices faits en classe, cas pratiques, examens notés
                    </li>
                    <li className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> Export PDF, Word et PowerPoint
                    </li>
                  </ul>
                  {current ? (
                    <Button className="mt-5" variant="secondary" disabled>
                      Offre actuelle
                    </Button>
                  ) : paid ? (
                    <Button className="mt-5" variant="outline" asChild>
                      <a href={data.portal} target="_blank" rel="noopener noreferrer">
                        Passer à cette offre
                      </a>
                    </Button>
                  ) : (
                    <Button className="mt-5" variant={o.highlight ? "default" : "outline"} asChild data-testid={`button-subscribe-${o.id}`}>
                      <a href={data.checkout[o.id]}>
                        <Sparkles className="mr-2 h-4 w-4" /> S'abonner
                      </a>
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Prix TTC. Gratuit : {Math.round(data.plans.free.audioSec / 60)} min de transcription et {data.plans.free.gens} générations IA par mois, avec le même report. Les cours
            publiés restent consultables par tous, même sans abonnement. Pour résilier, utilise « Gérer ou résilier » avec l'adresse e-mail de ton compte.
          </p>
          <button className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={() => navigate("/privacy")}>
            Confidentialité et données
          </button>
        </section>
      )}
    </div>
  );
}

/** Explication des limites et du report du solde non utilisé. */
function HowLimitsWork({ data }: { data: Billing }) {
  const m = data.plans.month;
  const h = Math.round(m.audioSec / 3600);
  return (
    <section className="rounded-2xl border border-card-border bg-card p-5 sm:p-6" data-testid="section-how-limits">
      <h2 className="text-lg font-semibold">Comment fonctionnent tes limites</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-secondary/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="h-4 w-4 text-primary" /> Ce qui est compté
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Le temps de cours transcrit, et chaque génération IA : notes, fiche de révision, série d'exercices, examen blanc ou correction des exercices faits en
            classe. Une série d'exercices compte pour une seule génération, quel que soit le nombre de questions : QCM, questions de cours, applications et cas
            pratiques avec tableaux. Relire, refaire un exercice, passer un examen ou exporter ne compte pas.
          </p>
        </div>
        <div className="rounded-xl bg-secondary/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Repeat className="h-4 w-4 text-primary" /> Le non-utilisé est reporté
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Ce que tu n'as pas utilisé pendant une période n'est pas perdu : il s'ajoute à la période suivante. Le report vaut pour la période qui suit
            immédiatement et il est plafonné à un forfait. Au maximum, tu disposes donc du double de ton forfait sur une période.
          </p>
        </div>
        <div className="rounded-xl bg-secondary/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" /> Exemple
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Avec l'offre Mensuel ({h} h et {m.gens} générations), tu utilises 30 h et 40 générations en octobre. En novembre, tu disposes de {h} h + {h - 30} h ={" "}
            {h + h - 30} h et de {m.gens} + {m.gens - 40} = {m.gens + m.gens - 40} générations. Ce qui reste de novembre passe ensuite sur décembre, et ainsi de
            suite.
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        En abonnement, le report commence après ta première période payée et continue tant que l'abonnement est actif. Si tu résilies, tout ce qui te reste
        est utilisable jusqu'à la fin de la période déjà payée. Si tu changes d'offre, le report est recalculé avec les limites de la nouvelle offre. En gratuit,
        le report fonctionne de la même façon d'un mois civil à l'autre.
      </p>
    </section>
  );
}

/** Fenêtre affichée quand une limite de l'offre est atteinte (réponse 402 du serveur). */
export function QuotaDialog() {
  const [, navigate] = useLocation();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setMsg(d.message || "Limite de ton offre atteinte.");
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
    };
    window.addEventListener("cs:quota", on);
    return () => window.removeEventListener("cs:quota", on);
  }, []);
  return (
    <AlertDialog open={!!msg} onOpenChange={(o) => !o && setMsg(null)}>
      <AlertDialogContent data-testid="dialog-quota">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-[#FE277E]" /> Limite atteinte
          </AlertDialogTitle>
          <AlertDialogDescription>{msg}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Plus tard</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setMsg(null);
              navigate("/abonnement");
            }}
            data-testid="button-see-plans"
          >
            Voir les offres
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
