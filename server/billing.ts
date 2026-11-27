import { createHmac, timingSafeEqual } from "node:crypto";
import { q, one } from "./db";
import type { User } from "@shared/schema";

/**
 * Abonnements Stripe (mode réel).
 * Paiement par liens Stripe (Payment Links) + webhook signé : aucune clé secrète Stripe n'est stockée dans l'application.
 * Gestion / résiliation : portail client Stripe (connexion par e-mail).
 */

export type PlanId = "free" | "twoweeks" | "month" | "year";

/** Liens de paiement et portail (identifiants publics, non secrets). Surchargeables par variables d'environnement. */
export const STRIPE = {
  links: {
    twoweeks: process.env.STRIPE_LINK_TWOWEEKS || "https://buy.stripe.com/00w3cv3Kz0od7vd4258so03",
    month: process.env.STRIPE_LINK_MONTH_V2 || "https://buy.stripe.com/3cI6oHa8X4Et9Dl8il8so04",
    year: process.env.STRIPE_LINK_YEAR_V2 || "https://buy.stripe.com/fZu9AT1Cr6MBdTB8il8so05",
  },
  portal: process.env.STRIPE_PORTAL_URL || "https://billing.stripe.com/p/login/fZu9ATepd8UJbLtgOR8so00",
  prices: {
    price_1UgPI4FUc88TI49NILsJexxB: "twoweeks",
    price_1UgPI6FUc88TI49NmdncbD8S: "month",
    price_1UgPI9FUc88TI49NTziMLIu3: "year",
    // anciens tarifs (archivés, aucun abonné) : conservés pour la lecture des événements
    price_1Ug0FUFUc88TI49NvivfElaM: "twoweeks",
    price_1Ug0FWFUc88TI49NqCrHYdCf: "month",
    price_1Ug0FYFUc88TI49N0HZ98BIT: "year",
  } as Record<string, PlanId>,
};

const HOUR = 3600;
/**
 * Limites d'usage par période (usage raisonnable). Fixées à partir du coût réel mesuré de l'API Gemini :
 * 0,0313 € par heure transcrite et 0,0171 € par génération. Prix TTC (TVA 20 %), frais carte 1,5 % + 0,25 €,
 * Billing 0,7 %, Managed Payments 3,5 % : chaque formule reste bénéficiaire même quota entièrement consommé.
 */
export const PLANS: Record<PlanId, { label: string; price: string; audioSec: number; gens: number; window: string }> = {
  free: { label: "Gratuit", price: "0 €", audioSec: 1 * HOUR, gens: 3, window: "par mois" },
  twoweeks: { label: "Pass 2 semaines", price: "2,99 € / 2 semaines", audioSec: 25 * HOUR, gens: 30, window: "toutes les 2 semaines" },
  month: { label: "Mensuel", price: "5,99 € / mois", audioSec: 50 * HOUR, gens: 60, window: "par mois" },
  year: { label: "Annuel", price: "49,99 € / an", audioSec: 50 * HOUR, gens: 60, window: "par mois" },
};

const OWNER_EMAILS = (process.env.OWNER_EMAILS || "kouassikoffiaime631@gmail.com")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const GEN_KINDS = ["notes", "sheet", "exercises", "exam", "class_exercises"];
const ACTIVE = ["active", "trialing", "past_due"];
const DAY = 86400_000;

type BillingRow = {
  customer_id: string;
  user_id: number | null;
  subscription_id: string | null;
  status: string;
  plan: PlanId | null;
  period_start: number | null;
  period_end: number | null;
  cancel_at_period_end: boolean;
  subscribed_at: number | null;
};

export type BillingState = {
  plan: PlanId;
  exempt: boolean;
  status: string | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  window: { start: number; end: number };
  usage: { audioSec: number; gens: number };
  /** Limites totales de la période = forfait + report du solde non utilisé de la période précédente. */
  limits: { audioSec: number; gens: number } | null;
  base: { audioSec: number; gens: number } | null;
  carry: { audioSec: number; gens: number };
};

function monthStart(now: number) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function addMonth(t: number) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

/** Fenêtre de décompte : 2 semaines ou mois d'abonnement en cours (mois glissants pour l'annuel), mois civil en gratuit. */
function usageWindow(plan: PlanId, sub: BillingRow | undefined, now: number) {
  if (plan === "free" || !sub?.period_start) {
    const s = monthStart(now);
    return { start: s, end: addMonth(s) };
  }
  if (plan === "twoweeks" || plan === "month") return { start: sub.period_start, end: sub.period_end || sub.period_start + (plan === "twoweeks" ? 14 : 31) * DAY };
  let s = sub.period_start;
  while (addMonth(s) <= now) s = addMonth(s);
  return { start: s, end: addMonth(s) };
}

/** Période précédente de même durée (2 semaines, mois d'abonnement ou mois civil). */
function previousWindow(plan: PlanId, w: { start: number; end: number }, sub: BillingRow | undefined) {
  if (plan === "free" || !sub?.period_start) {
    const d = new Date(w.start);
    return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1), end: w.start };
  }
  if (plan === "twoweeks") return { start: w.start - 14 * DAY, end: w.start };
  const d = new Date(w.start);
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()), end: w.start };
}

async function usageBetween(userId: number, start: number, end: number) {
  const r = await one<{ audio: number; gens: number }>(
    `select coalesce(sum(audio_seconds) filter (where kind like 'stt%'), 0)::int as audio,
            count(*) filter (where kind = any($4))::int as gens
       from public.ai_usage where user_id = $1 and created_at >= $2 and created_at < $3`,
    [userId, start, end, GEN_KINDS],
  );
  return { audioSec: r?.audio ?? 0, gens: r?.gens ?? 0 };
}

const cache = new Map<number, { at: number; state: BillingState }>();
export function invalidateBilling(userId: number) {
  cache.delete(userId);
}

export function isExempt(u: User & { billingExempt?: boolean }) {
  return !!u.billingExempt || OWNER_EMAILS.includes(u.email.toLowerCase());
}

export async function billingState(u: User, fresh = false): Promise<BillingState> {
  const hit = cache.get(u.id);
  if (!fresh && hit && Date.now() - hit.at < 20_000) return hit.state;
  const now = Date.now();
  const row = await one<{ billing_exempt: boolean; stripe_customer_id: string | null; created_at: number | string | Date | null }>(
    `select billing_exempt, stripe_customer_id, created_at from public.users where id = $1`,
    [u.id],
  );
  const exempt = !!row?.billing_exempt || OWNER_EMAILS.includes(u.email.toLowerCase());
  const subs = await q<BillingRow>(
    `select * from public.billing where user_id = $1 or ($2::text is not null and customer_id = $2) order by updated_at desc`,
    [u.id, row?.stripe_customer_id ?? null],
  );
  const sub = subs.find((s) => ACTIVE.includes(s.status) && s.plan && (!s.period_end || s.period_end + 2 * DAY > now));
  const plan: PlanId = sub?.plan ?? "free";
  const window = usageWindow(plan, sub, now);
  const usage = await usageBetween(u.id, window.start, window.end);
  // Report : ce qui n'a pas été utilisé pendant la période précédente reste disponible pendant la période en cours
  // (un seul report, plafonné à un forfait). En abonnement, seulement si la période précédente était déjà payée.
  const base = { audioSec: PLANS[plan].audioSec, gens: PLANS[plan].gens };
  const prev = previousWindow(plan, window, sub);
  const rawCreated = row?.created_at instanceof Date ? row.created_at.getTime() : Number(row?.created_at);
  const createdAt = Number.isFinite(rawCreated) && rawCreated > 0 ? (rawCreated < 1e12 ? rawCreated * 1000 : rawCreated) : Date.now();
  const eligible = plan === "free" ? createdAt < prev.end : !!sub?.subscribed_at && sub.subscribed_at <= prev.start + DAY;
  let carry = { audioSec: 0, gens: 0 };
  if (!exempt && eligible) {
    const used = await usageBetween(u.id, prev.start, prev.end);
    carry = { audioSec: Math.max(0, base.audioSec - used.audioSec), gens: Math.max(0, base.gens - used.gens) };
  }
  const state: BillingState = {
    plan,
    exempt,
    status: sub?.status ?? subs[0]?.status ?? null,
    periodEnd: sub?.period_end ?? null,
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    window,
    usage,
    limits: exempt ? null : { audioSec: base.audioSec + carry.audioSec, gens: base.gens + carry.gens },
    base: exempt ? null : base,
    carry,
  };
  cache.set(u.id, { at: now, state });
  return state;
}

/** Message de dépassement, ou null si l'action est permise. */
export async function quotaError(u: User, kind: "audio" | "gen", extraAudioSec = 0): Promise<null | { code: string; message: string; plan: PlanId }> {
  const s = await billingState(u);
  if (!s.limits) return null;
  if (kind === "audio" && s.usage.audioSec + extraAudioSec > s.limits.audioSec + 60) {
    return {
      code: "quota_audio",
      plan: s.plan,
      message:
        s.plan === "free"
          ? "Tu as utilisé tout ton temps de transcription gratuit ce mois-ci (report compris). Passe à Premium pour continuer à enregistrer."
          : `Tu as utilisé tes ${Math.round(s.limits.audioSec / HOUR)} h de transcription de cette période (report compris).`,
    };
  }
  if (kind === "gen" && s.usage.gens >= s.limits.gens) {
    return {
      code: "quota_gen",
      plan: s.plan,
      message:
        s.plan === "free"
          ? `Tu as utilisé tes ${s.limits.gens} générations IA gratuites ce mois-ci (report compris). Passe à Premium pour générer notes, fiches, exercices et examens sans attendre.`
          : `Tu as utilisé tes ${s.limits.gens} générations IA de cette période (report compris).`,
    };
  }
  return null;
}

// ---------------- Webhook ----------------

/** Vérifie la signature Stripe (en-tête Stripe-Signature, HMAC SHA-256, tolérance 5 min). */
export function verifyStripeSignature(raw: Buffer, header: string, secret: string) {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const sigs = header
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => kv.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest();
  return sigs.some((s) => {
    const b = Buffer.from(s, "hex");
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

const sec = (v: any) => (typeof v === "number" && v > 0 ? v * 1000 : null);

async function upsertSubscription(s: any) {
  const item = s.items?.data?.[0];
  const priceId: string | undefined = item?.price?.id;
  const plan: PlanId | null =
    (priceId && STRIPE.prices[priceId]) ||
    (s.metadata?.plan as PlanId) ||
    (item?.price?.recurring?.interval === "week" ? "twoweeks" : item?.price?.recurring?.interval === "year" ? "year" : item?.price?.recurring?.interval === "month" ? "month" : null);
  const start = sec(s.current_period_start) ?? sec(item?.current_period_start);
  const end = sec(s.current_period_end) ?? sec(item?.current_period_end);
  const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
  if (!customer) return;
  await q(
    `insert into public.billing (customer_id, subscription_id, status, plan, price_id, period_start, period_end, cancel_at_period_end, updated_at, subscribed_at, user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (select id from public.users where stripe_customer_id = $1))
     on conflict (customer_id) do update set
       subscription_id = excluded.subscription_id, status = excluded.status, plan = excluded.plan, price_id = excluded.price_id,
       period_start = excluded.period_start, period_end = excluded.period_end, cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = excluded.updated_at,
       subscribed_at = case when public.billing.subscription_id = excluded.subscription_id then coalesce(public.billing.subscribed_at, excluded.subscribed_at) else excluded.subscribed_at end,
       user_id = coalesce(public.billing.user_id, excluded.user_id)
     where public.billing.updated_at <= excluded.updated_at`,
    [customer, s.id, s.status, plan, priceId ?? null, start, end, !!(s.cancel_at_period_end || s.cancel_at), Number(s.__eventCreated) || Date.now(), sec(s.start_date) ?? start],
  );
  const r = await one<{ user_id: number | null }>(`select user_id from public.billing where customer_id = $1`, [customer]);
  if (r?.user_id) invalidateBilling(r.user_id);
}

async function linkCheckout(session: any) {
  const userId = Number(session.client_reference_id) || null;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customer) return;
  let uid = userId;
  if (!uid) {
    const email = session.customer_details?.email || session.customer_email;
    if (email) uid = (await one<{ id: number }>(`select id from public.users where lower(email) = lower($1)`, [email]))?.id ?? null;
  }
  if (!uid) return;
  await q(`update public.users set stripe_customer_id = $2 where id = $1`, [uid, customer]);
  await q(
    `insert into public.billing (customer_id, user_id, subscription_id, status, updated_at)
     values ($1, $2, $3, 'incomplete', 0)
     on conflict (customer_id) do update set user_id = excluded.user_id,
       subscription_id = coalesce(public.billing.subscription_id, excluded.subscription_id)`,
    [customer, uid, typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null],
  );
  invalidateBilling(uid);
}

export async function handleStripeEvent(evt: any) {
  const seen = await q(`insert into public.stripe_events (id, type, created_at) values ($1, $2, $3) on conflict do nothing returning id`, [
    evt.id,
    evt.type,
    Date.now(),
  ]);
  if (!seen.length) return "duplicate";
  const obj = evt.data?.object;
  if (!obj) return "empty";
  if (evt.type === "checkout.session.completed") await linkCheckout(obj);
  else if (evt.type.startsWith("customer.subscription.")) await upsertSubscription({ ...obj, __eventCreated: (evt.created || 0) * 1000 });
  return "ok";
}

export function checkoutUrl(plan: Exclude<PlanId, "free">, u: User) {
  const base = STRIPE.links[plan];
  const p = new URLSearchParams({ client_reference_id: String(u.id), prefilled_email: u.email, locale: "fr" });
  return `${base}?${p.toString()}`;
}
export function portalUrl(u: User) {
  return `${STRIPE.portal}?prefilled_email=${encodeURIComponent(u.email)}`;
}
