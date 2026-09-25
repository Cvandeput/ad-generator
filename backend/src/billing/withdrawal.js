// Droit de rétractation — calcul d'éligibilité et du montant remboursé.
//
// Pourquoi ce module n'implémente PAS ce que l'exploitant demandait au départ
// (« pas de remboursement au-delà de 50 % du quota consommé ») : une condition
// qui supprime ou restreint le droit de rétractation d'un consommateur est une
// clause abusive, réputée non écrite. Elle ne protège pas, elle expose — le
// client obtient son remboursement intégral ET l'exploitant a une clause
// illicite affichée sur son site. Raisonnement complet : docs/RETRACTATION.md.
//
// Ce qui protège réellement l'exploitant est ailleurs, dans l'article 14(3) de
// la directive 2011/83/UE : le consommateur qui a demandé que l'exécution
// commence pendant le délai doit payer « un montant proportionnel à ce qui lui
// a été fourni ». 60 générations sur 100 → il paie 60 %, on rembourse 40 %.
// C'est exactement la protection recherchée, et elle est opposable.
//
// Tout est en CENTIMES ENTIERS. Aucun flottant ne touche un montant.
import db from '../db.js';
import { config } from '../config.js';
import { PLANS, PAID_KEYS, planCents, PACK_CENTS, PACK } from './plans.js';
import {
  getSubscription, getUser, lastWithdrawal, lastCreditPurchase, priorContractWithdrawal,
  usedSince, pendingGenerations, PENDING_STALE_AFTER,
} from './store.js';

// Version du texte de consentement. À incrémenter dès que la formulation
// change : une trace de consentement sans version ne prouve pas ce qui a été
// accepté, donc ne prouve rien.
export const CONSENT_VERSION = process.env.WITHDRAWAL_CONSENT_VERSION || '2026-09-17';

// 14 jours : art. VI.47 CDE / art. 9 de la directive.
export const WITHDRAWAL_DAYS = 14;

// Fenêtre glissante du garde-fou anti-abus. Elle ne SUPPRIME pas le droit (ce
// serait illicite) : au-delà, la demande est enregistrée en `review` et traitée
// à la main au lieu d'être remboursée automatiquement. Cf. §4 de la doc.
// Validée : une valeur non numérique donnait NaN, donc une date invalide, et
// `toISOString()` levait une exception à CHAQUE lecture de l'état de
// rétractation. 0 est admis (garde-fou désactivé) ; au-delà de 10 ans, ou
// invalide, on retombe sur 365.
function cooldownDays(raw) {
  if (raw === undefined || raw === '') return 365;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n <= 3650) return n;
  console.warn(`[billing] WITHDRAWAL_COOLDOWN_DAYS invalide (${raw}) : 365 jours appliqués.`);
  return 365;
}
export const COOLDOWN_DAYS = cooldownDays(process.env.WITHDRAWAL_COOLDOWN_DAYS);

const DAY_MS = 24 * 3600 * 1000;

// Au-delà de cette ancienneté, une génération `pending` est orpheline (serveur
// arrêté en pleine génération : la ligne n'est jamais passée `done`/`error`).
// Elle ne doit pas bloquer indéfiniment la rétractation d'un pack — ce serait
// un refus du droit déguisé. Deux fois le délai n8n, une heure au minimum.
const PENDING_GENERATION_MS = Math.max(2 * (Number(config.n8nTimeoutMs) || 0), 3600 * 1000);

// Les dates SQLite sont en UTC « YYYY-MM-DD HH:MM:SS », les dates Node en ISO.
// parseServerDate côté front fait la même gymnastique ; sans le « Z », Node
// interprète la date en heure locale et on perd (ou gagne) deux heures.
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  const iso = /[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

// Jours restants, comptés en JOURS CALENDAIRES et non en tranches de 24 h.
// L'écart n'est pas cosmétique : l'échéance étant la FIN du 14e jour, un simple
// `ceil(msRestantes / 24 h)` affiche « il vous reste 15 jours » le jour même de
// la souscription, sur un droit qui en dure 14. Le dernier jour est ramené à 1
// plutôt qu'à 0 : « il vous reste 1 jour » est exact, « 0 jour » laisse croire
// que le délai est déjà clos alors qu'il court jusqu'à minuit.
export function calendarDaysLeft(deadline, now) {
  if (!deadline) return 0;
  const midnight = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((midnight(deadline) - midnight(now)) / DAY_MS);
  return Math.max(1, diff);
}

// Fin du délai : 14 jours après la conclusion, prolongés jusqu'à la fin de
// cette journée-là. Le délai légal se compte en jours calendaires et expire à
// la fin du dernier jour — arrêter le calcul à l'heure exacte de souscription
// retirerait au consommateur jusqu'à 23 heures de son droit.
export function deadlineFrom(startedAt, days = WITHDRAWAL_DAYS) {
  const start = parseDate(startedAt);
  if (!start) return null;
  const end = new Date(start.getTime() + days * DAY_MS);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * Montant remboursé, en centimes entiers.
 *
 *   remboursé = payé × (1 − fourni / quota)
 *
 * Trois règles qui ne sont pas des détails :
 *
 * 1. `consented = false` → remboursement INTÉGRAL. Le prorata de l'art. 14(3)
 *    n'existe que si le consommateur a expressément demandé l'exécution
 *    immédiate. Sans cette trace, réclamer une part du prix n'est pas fondé.
 *    C'est la raison d'être de la case au moment du paiement.
 *
 * 2. `fourni` est BORNÉ AU QUOTA. Les générations au-delà du quota mensuel ont
 *    été payées par des crédits achetés à part — un autre contrat. Les compter
 *    ici ferait passer le ratio au-dessus de 100 % et produirait un
 *    remboursement négatif, c'est-à-dire une facture surprise.
 *
 * 3. Arrondi au centime EN FAVEUR DU CONSOMMATEUR (`ceil`). Un arrondi
 *    « mathématique » qui tombe systématiquement du côté du professionnel est
 *    précisément le genre de détail qui transforme un litige évitable en
 *    plainte. Le coût maximal est d'un centime par rétractation.
 */
export function proratedRefundCents({ paidCents, used, quota, consented = true }) {
  // Un montant non fini (Infinity) n'est pas un paiement : 0, pas un virement
  // aberrant envoyé à Stripe.
  const p = Number(paidCents);
  const paid = Number.isFinite(p) ? Math.max(0, Math.round(p)) : 0;
  if (!paid) return { refundCents: 0, billable: 0, retainedCents: 0 };

  if (!consented) return { refundCents: paid, billable: 0, retainedCents: 0 };

  const q = Math.trunc(Number(quota) || 0);
  const u = Math.max(0, Math.trunc(Number(used) || 0));

  // quota ≤ 0 : rien n'a été fourni AU TITRE de l'abonnement (le cas se
  // présente sur un plan à quota nul, ou si la synchronisation Stripe n'a pas
  // encore écrit le quota). Pas de division par zéro, pas de NaN : on
  // rembourse tout, ce qui est aussi la lecture la plus défendable.
  // Quota infini (compte administrateur) : Infinity / Infinity donnait NaN, et
  // l'INSERT du journal échouait. La part fournie d'un quota illimité tend vers
  // 0 : même lecture, remboursement intégral.
  if (!Number.isFinite(q) || q <= 0) return { refundCents: paid, billable: 0, retainedCents: 0 };

  const billable = Math.min(u, q);
  const refundCents = Math.min(paid, Math.max(0, Math.ceil((paid * (q - billable)) / q)));
  return { refundCents, billable, retainedCents: paid - refundCents };
}

// --- Éligibilité : abonnement -----------------------------------------------
// Codes de refus (le front les traduit, cf. locales/*.json → withdrawal.reason.*)
//   NO_SUBSCRIPTION  pas d'abonnement payant actif
//   WINDOW_EXPIRED   au-delà des 14 jours à compter de la conclusion
//   ALREADY_PENDING  une demande est déjà en cours de traitement
export function withdrawalState(userId, { now = new Date() } = {}) {
  const user = getUser(userId);
  if (!user) return { eligible: false, reason: 'NO_SUBSCRIPTION', kind: 'subscription' };

  const sub = getSubscription(userId);
  const paidPlan = sub && PAID_KEYS.includes(sub.plan_key);
  const live = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
  if (!paidPlan || !live) {
    return { eligible: false, reason: 'NO_SUBSCRIPTION', kind: 'subscription' };
  }

  // Quota et consommation du CONTRAT, lus sur l'abonnement lui-même. Pour un
  // client, c'est exactement ce que renvoie quotaState ; pour un compte
  // administrateur, quotaState renvoie un quota infini (aucun décompte) et
  // une consommation depuis la création du compte, qui n'ont rien à voir avec
  // l'abonnement payé — le prorata en sortait en NaN.
  const q = { quota: Number(sub.quota_month) || 0, used: usedSince(userId, sub.period_start) };
  // Repli sur period_start pour les abonnements souscrits avant l'ajout de la
  // colonne : sans lui, `subscribed_at` est nul et tout le monde deviendrait
  // éligible (ou personne), selon la façon dont on lit une date absente.
  const startedAt = sub.subscribed_at || sub.period_start || user.created_at;
  const deadline = deadlineFrom(startedAt);
  const paidCents = Number.isFinite(sub.last_paid_cents) && sub.last_paid_cents != null
    ? Math.round(sub.last_paid_cents)
    : planCents(sub.plan_key);

  const consented = !!user.withdrawal_consent_at;
  const calc = proratedRefundCents({ paidCents, used: q.used, quota: q.quota, consented });

  const pending = db
    .prepare(`SELECT id FROM withdrawals WHERE user_id = ? AND kind = 'subscription' AND status = 'pending'
                AND requested_at > ${PENDING_STALE_AFTER}`)
    .get(userId);

  const msLeft = deadline ? deadline.getTime() - now.getTime() : -1;
  const expired = msLeft < 0;

  // Garde-fou anti-abus : une seule rétractation AUTOMATIQUE par fenêtre
  // glissante. Au-delà, on n'oppose pas un refus — on enregistre la demande
  // pour traitement manuel. La nuance est ce qui sépare un encadrement licite
  // d'une clause abusive.
  const since = sqlDate(new Date(now.getTime() - COOLDOWN_DAYS * DAY_MS));
  const previous = lastWithdrawal(userId, since, 'subscription');
  // Demande précédente sur CE contrat déjà remboursée, en échec ou confiée à
  // l'exploitant : jamais de second remboursement automatique (cf. store.js).
  const sameContract = priorContractWithdrawal(userId, 'subscription', sub.stripe_subscription_id || null);

  return {
    kind: 'subscription',
    eligible: !expired && !pending,
    reason: expired ? 'WINDOW_EXPIRED' : pending ? 'ALREADY_PENDING' : null,
    planKey: sub.plan_key,
    planLabel: (PLANS[sub.plan_key] || PLANS.free).label,
    subscribedAt: startedAt,
    deadline: deadline ? sqlDate(deadline) : null,
    daysLeft: expired ? 0 : calendarDaysLeft(deadline, now),
    used: q.used,
    quota: q.quota,
    billable: calc.billable,
    paidCents,
    refundCents: calc.refundCents,
    retainedCents: calc.retainedCents,
    consented,
    consentAt: user.withdrawal_consent_at || null,
    consentVersion: user.withdrawal_consent_version || null,
    // true = la demande sera enregistrée et traitée à la main, pas remboursée
    // automatiquement. Le front le dit à l'utilisateur AVANT qu'il confirme.
    manualReview: !!previous || !!sameContract,
    stripeSubscriptionId: sub.stripe_subscription_id || null,
  };
}

// --- Éligibilité : pack de crédits (régime distinct) -------------------------
// Un pack est un paiement unique, pas un abonnement : sa fenêtre de 14 jours
// part de SON achat. Le raisonnement juridique (contenu numérique vs service)
// et l'arbitrage retenu sont dans docs/RETRACTATION.md §5.
//
// Règle appliquée : sont remboursables les crédits encore en réserve, dans la
// limite de ceux vendus par ce pack. Les crédits sont fongibles — impossible de
// dire lequel vient de quel pack — et cette lecture est la plus favorable au
// consommateur, donc la plus sûre.
//
// Codes de refus propres au pack (en plus de WINDOW_EXPIRED / ALREADY_PENDING) :
//   NO_PACK              aucun pack acheté et non rétracté
//   GENERATIONS_PENDING  une génération tourne encore : réessayer à sa fin
export function packWithdrawalState(userId, { now = new Date() } = {}) {
  const user = getUser(userId);
  if (!user) return { eligible: false, reason: 'NO_PACK', kind: 'pack' };

  const purchase = lastCreditPurchase(userId);
  if (!purchase) return { eligible: false, reason: 'NO_PACK', kind: 'pack' };

  const deadline = deadlineFrom(purchase.created_at);
  const msLeft = deadline ? deadline.getTime() - now.getTime() : -1;
  const expired = msLeft < 0;

  const bought = Math.max(0, Math.trunc(purchase.credits));
  const inReserve = Math.max(0, Math.trunc(user.extra_credits || 0));
  const refundable = Math.min(bought, inReserve);
  const paidCents = Math.round(purchase.paid_cents || PACK_CENTS);
  // Même arrondi en faveur du consommateur que pour l'abonnement.
  const refundCents = bought > 0 ? Math.min(paidCents, Math.ceil((paidCents * refundable) / bought)) : paidCents;

  const pending = db
    .prepare(`SELECT id FROM withdrawals WHERE user_id = ? AND kind = 'pack' AND status = 'pending'
                AND requested_at > ${PENDING_STALE_AFTER}`)
    .get(userId);

  // Génération en cours : son crédit sera débité à la fin, APRÈS un
  // remboursement qui l'aurait compté comme inutilisé. Ce n'est pas un refus du
  // droit, seulement un « pas maintenant » de quelques minutes.
  const generating = pendingGenerations(userId, sqlDate(new Date(now.getTime() - PENDING_GENERATION_MS))) > 0;

  const sameContract = priorContractWithdrawal(userId, 'pack', purchase.id);

  return {
    kind: 'pack',
    eligible: !expired && !pending && !generating,
    reason: expired ? 'WINDOW_EXPIRED' : pending ? 'ALREADY_PENDING' : generating ? 'GENERATIONS_PENDING' : null,
    purchaseId: purchase.id,
    purchasedAt: purchase.created_at,
    deadline: deadline ? sqlDate(deadline) : null,
    daysLeft: expired ? 0 : calendarDaysLeft(deadline, now),
    credits: bought,
    creditsLeft: inReserve,
    refundableCredits: refundable,
    label: PACK.label,
    paidCents,
    refundCents,
    retainedCents: paidCents - refundCents,
    // Même règle que pour l'abonnement : une demande précédente sur ce pack
    // remboursée, en échec ou en revue → traitement manuel, jamais un refus.
    manualReview: !!sameContract,
    stripePaymentIntent: purchase.stripe_payment_intent || null,
  };
}
