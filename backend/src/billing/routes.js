// Routes de facturation. Montées uniquement si BILLING_ENABLED=true.
//
// Deux modes :
//   - demo  : aucune clé Stripe → l'abonnement est simulé en base (pour voir la
//             page et tester les quotas sans compte Stripe). Rien n'est facturé.
//   - stripe: Checkout + Customer Portal + webhook signés.
import { Router, raw } from 'express';
import { config } from '../config.js';
import requireAuth from '../middleware/requireAuth.js';
import { PLANS, PACK, PAID_KEYS, publicPlans, planFromPriceId, PACK_CENTS, ACTIVE_STATUSES } from './plans.js';
import { quotaState } from './quota.js';
import { hasStripeKey, stripe, periodOf } from './stripe.js';
import {
  migrate, getUser, getUserByCustomer, setCustomerId, getSubscription,
  upsertSubscription, claimEvent, releaseEvent,
  setWithdrawalConsent, setLastPayment, creditPack, insertWithdrawal,
  finishWithdrawal, attachRefund, markPackWithdrawn, removeCredits, listWithdrawals,
  isDeletedUser, getDeletedUserByCustomer,
} from './store.js';
import { withdrawalState, packWithdrawalState, CONSENT_VERSION, WITHDRAWAL_DAYS } from './withdrawal.js';

migrate();

export const MODE = hasStripeKey() ? 'stripe' : 'demo';
const router = Router();
const origin = () => config.allowedOrigins[0] || `http://localhost:${config.port}`;
const log = (event, extra) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...extra }));

// --- Lecture -----------------------------------------------------------------
router.get('/plans', (_req, res) => {
  res.json({ mode: MODE, plans: publicPlans(), pack: { credits: PACK.credits, eur: PACK.eur } });
});

router.get('/subscription', requireAuth, (req, res) => {
  res.json({ mode: MODE, ...quotaState(req.session.userId) });
});

// --- Abonnement ---------------------------------------------------------------
async function customerFor(userId) {
  const user = getUser(userId);
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const s = await stripe();
  const c = await s.customers.create({ email: user.email, metadata: { userId: String(user.id) } });
  setCustomerId(user.id, c.id);
  return c.id;
}

// Simule un abonnement actif de 30 jours (mode démo uniquement).
// La période démarre à la seconde suivante : `created_at` est stocké à la
// seconde près, sans ça une génération faite dans la même seconde que la
// souscription serait décomptée de la nouvelle période.
//
// Identifiant = le CONTRAT, comme chez Stripe : un abonnement encore actif garde
// le sien (un changement de formule modifie le contrat, il n'en ouvre pas un
// nouveau), un réabonnement après résiliation en reçoit un neuf — et avec lui
// sa propre date de conclusion, donc son propre délai de 14 jours (cf.
// upsertSubscription). Un identifiant dérivé de la formule faisait l'inverse.
function demoSubscribe(userId, plan) {
  const now = new Date(Date.now() + 1000);
  const end = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const current = getSubscription(userId);
  const subId = current?.stripe_subscription_id && ACTIVE_STATUSES.has(current.status)
    ? current.stripe_subscription_id
    : `demo_${userId}_${Date.now().toString(36)}`;
  upsertSubscription({
    user_id: userId, stripe_subscription_id: subId, plan_key: plan.key,
    status: 'active', quota_month: plan.quota, period_start: fmt(now), period_end: fmt(end), cancel_at_period_end: 0,
  });
  log('billing.demo_subscribe', { userId, plan: plan.key });
}

// Mention exacte soumise à l'utilisateur avant le paiement. Elle vit ici, côté
// serveur, et pas seulement dans le dictionnaire du front : c'est ce texte-là
// qui est horodaté et qu'il faudra produire en cas de litige. Le front l'affiche
// dans la langue du visiteur (clé `withdrawal.consent.*`), le fond est identique.
const CONSENT_TEXT_FR =
  "Je demande expressément que l'exécution du service commence immédiatement, avant la fin du délai de rétractation de 14 jours. " +
  "Je reconnais perdre mon droit de rétractation pour chaque visuel effectivement généré et, si je me rétracte, devoir payer au prorata la part du service déjà fournie.";

// Le consentement est écrit AVANT la redirection vers Stripe. S'il était écrit
// au retour, un abandon de panier suivi d'un paiement par un autre chemin
// laisserait un abonnement payé sans trace de consentement — donc remboursable
// à 100 %. Écrit trop tôt, il est au pire inutile : sans abonnement, il ne sert
// à rien et ne coûte rien.
function recordConsent(req) {
  setWithdrawalConsent(req.session.userId, CONSENT_VERSION, req.ip || null);
  log('billing.withdrawal_consent', { userId: req.session.userId, version: CONSENT_VERSION });
}

const consentGiven = (body) => body?.withdrawalConsent === true || body?.withdrawalConsent === 'true';

router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const key = String(req.body.plan || '');
    if (!PAID_KEYS.includes(key)) return res.status(400).json({ error: 'Formule inconnue' });
    const plan = PLANS[key];

    // Sans consentement exprès, pas de prorata possible : la rétractation
    // donnerait droit au remboursement intégral. On refuse donc l'achat plutôt
    // que de vendre un abonnement qu'on ne peut pas défendre.
    if (!consentGiven(req.body)) {
      return res.status(400).json({
        code: 'WITHDRAWAL_CONSENT_REQUIRED',
        error: "Vous devez demander expressément le démarrage immédiat du service pour vous abonner.",
      });
    }
    recordConsent(req);

    if (MODE === 'demo') {
      demoSubscribe(req.session.userId, plan);
      return res.json({ demo: true, url: `/tarifs.html?demo=souscrit&plan=${plan.key}` });
    }
    if (!plan.priceId) return res.status(500).json({ error: `STRIPE_PRICE_${key.toUpperCase()} non configuré` });

    const s = await stripe();
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: await customerFor(req.session.userId),
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${origin()}/tarifs.html?checkout=success`,
      cancel_url: `${origin()}/tarifs.html?checkout=cancel`,
      allow_promotion_codes: true,
      locale: 'fr',
      // automatic_tax: { enabled: true },                 // à activer avec Stripe Tax
      // customer_update: { address: 'auto', name: 'auto' },
      // La mention est rappelée sur la page de paiement elle-même. Stripe n'a
      // pas de `consent_collection` pour la renonciation à la rétractation (il
      // ne propose que CGU et promotions) et, surtout, son accusé resterait
      // chez Stripe alors que le prorata se calcule ici : la trace qui compte
      // est celle qu'on vient d'écrire en base, ceci n'en est que le rappel.
      custom_text: { submit: { message: CONSENT_TEXT_FR.slice(0, 1200) } },
      subscription_data: {
        metadata: {
          userId: String(req.session.userId),
          planKey: plan.key,
          withdrawalConsentVersion: CONSENT_VERSION,
        },
      },
      client_reference_id: String(req.session.userId),
    });
    log('billing.checkout', { userId: req.session.userId, plan: plan.key });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// Pack de crédits (paiement unique). Contrat DISTINCT de l'abonnement : sa
// fenêtre de rétractation part de son propre achat (cf. docs/RETRACTATION.md §5).
router.post('/pack', requireAuth, async (req, res, next) => {
  try {
    if (!consentGiven(req.body)) {
      return res.status(400).json({
        code: 'WITHDRAWAL_CONSENT_REQUIRED',
        error: 'Vous devez demander expressément la mise à disposition immédiate des crédits.',
      });
    }
    recordConsent(req);

    if (MODE === 'demo') {
      // Tracé même en démo : sans ligne d'achat, la page tarifs ne peut pas
      // afficher d'encart de rétractation et le mode démo ne testerait plus rien.
      creditPack({
        user_id: req.session.userId,
        credits: PACK.credits,
        paid_cents: PACK_CENTS,
        stripe_session_id: `demo_pack_${req.session.userId}_${Date.now()}`,
      });
      return res.json({ demo: true, url: `/tarifs.html?demo=pack` });
    }
    if (!PACK.priceId) return res.status(500).json({ error: 'STRIPE_PRICE_PACK20 non configuré' });
    const s = await stripe();
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer: await customerFor(req.session.userId),
      line_items: [{ price: PACK.priceId, quantity: 1 }],
      success_url: `${origin()}/tarifs.html?pack=success`,
      cancel_url: `${origin()}/tarifs.html?pack=cancel`,
      locale: 'fr',
      custom_text: { submit: { message: CONSENT_TEXT_FR.slice(0, 1200) } },
      metadata: {
        userId: String(req.session.userId),
        kind: 'pack',
        credits: String(PACK.credits),
        withdrawalConsentVersion: CONSENT_VERSION,
      },
    });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// Portail client : carte, changement de formule, annulation, factures.
router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    if (MODE === 'demo') return res.status(409).json({ error: 'Portail indisponible en mode démo', demo: true });
    const s = await stripe();
    const session = await s.billingPortal.sessions.create({
      customer: await customerFor(req.session.userId),
      return_url: `${origin()}/tarifs.html`,
      locale: 'fr',
    });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// Résiliation (mode démo : repasse en free tout de suite).
router.post('/cancel', requireAuth, (req, res) => {
  if (MODE !== 'demo') return res.status(409).json({ error: 'Utilisez le portail client' });
  const sub = getSubscription(req.session.userId);
  if (sub) upsertSubscription({ ...sub, status: 'canceled', cancel_at_period_end: 0 });
  res.json({ ok: true, demo: true });
});

// --- Rétractation (14 jours) --------------------------------------------------
// Deux routes : une lecture qui montre le montant EXACT avant toute décision,
// une écriture qui exécute. Le montant est affiché avant confirmation parce
// qu'une mauvaise surprise sur un remboursement est la première cause de
// réclamation — et qu'une réclamation coûte plus cher que la différence.

// Les identifiants Stripe servent au serveur, pas à l'écran : on ne les expose pas.
const publicState = ({ stripeSubscriptionId, stripePaymentIntent, ...rest }) => rest;

router.get('/withdrawal', requireAuth, (req, res) => {
  const sub = withdrawalState(req.session.userId);
  const pack = packWithdrawalState(req.session.userId);
  res.json({
    mode: MODE,
    days: WITHDRAWAL_DAYS,
    consentVersion: CONSENT_VERSION,
    subscription: publicState(sub),
    pack: publicState(pack),
    history: listWithdrawals(req.session.userId).map((w) => ({
      id: w.id, kind: w.kind, refundCents: w.refund_cents, status: w.status, requestedAt: w.requested_at,
    })),
  });
});

// Messages des refus qui ne sont pas définitifs : l'utilisateur doit savoir
// qu'il peut réessayer. Les autres codes gardent le message générique (le
// front traduit de toute façon à partir du code).
const REFUSAL_MESSAGES = {
  GENERATIONS_PENDING: 'Une génération est en cours : réessayez dans quelques minutes.',
};

// Express 4 ne rattrape pas les rejets d'un handler async : une exception hors
// try (base verrouillée, montant invalide…) faisait tomber le processus. Le
// handler est donc enveloppé, toute erreur finit dans `next`.
router.post('/withdrawal', requireAuth, (req, res, next) => {
  postWithdrawal(req, res, next).catch(next);
});

async function postWithdrawal(req, res, next) {
  const userId = req.session.userId;
  const kind = req.body?.kind === 'pack' ? 'pack' : 'subscription';
  const state = kind === 'pack' ? packWithdrawalState(userId) : withdrawalState(userId);

  if (!state.eligible) {
    log('billing.withdrawal_refused', { userId, kind, reason: state.reason });
    return res.status(409).json({
      code: state.reason || 'NOT_ELIGIBLE',
      error: REFUSAL_MESSAGES[state.reason] || 'Rétractation impossible pour ce contrat.',
    });
  }

  // Garde-fou : un montant qui n'est pas un entier de centimes (NaN, Infinity)
  // ne doit ni être journalisé comme « calcul figé » ni partir chez Stripe.
  if (!Number.isSafeInteger(state.refundCents) || state.refundCents < 0) {
    throw new Error(`Montant de rétractation invalide (${state.refundCents}) pour l'utilisateur ${userId}`);
  }

  // Confirmation du montant côté client : si l'écran affichait un autre chiffre
  // (onglet resté ouvert pendant que des générations tournaient), on refuse et
  // on renvoie le montant à jour plutôt que de rembourser un montant que
  // l'utilisateur n'a jamais vu.
  const expected = req.body?.expectedRefundCents;
  if (expected !== undefined && Math.trunc(Number(expected)) !== state.refundCents) {
    return res.status(409).json({ code: 'AMOUNT_CHANGED', error: 'Le montant a changé, revalidez.', state: publicState(state) });
  }

  const withdrawalId = insertWithdrawal({
    user_id: userId,
    kind,
    plan_key: kind === 'pack' ? PACK.key : state.planKey,
    paid_cents: state.paidCents,
    quota: kind === 'pack' ? state.credits : state.quota,
    used: kind === 'pack' ? state.credits - state.refundableCredits : state.used,
    billable: kind === 'pack' ? state.credits - state.refundableCredits : state.billable,
    refund_cents: state.refundCents,
    consent_at: state.consentAt || null,
    consent_version: state.consentVersion || null,
    subscribed_at: kind === 'pack' ? state.purchasedAt : state.subscribedAt,
    deadline: state.deadline,
    status: 'pending',
    ip: req.ip || null,
    stripe_subscription_id: kind === 'pack' ? null : state.stripeSubscriptionId,
    credit_purchase_id: kind === 'pack' ? state.purchaseId : null,
  });

  // Traitement manuel, jamais un refus (ce serait une restriction du droit,
  // donc une clause abusive) : l'exploitant traite la demande à la main dans
  // le délai légal de remboursement de 14 jours. Deux cas :
  //   - garde-fou anti-abus : 2e rétractation d'abonnement sur la fenêtre
  //     glissante ;
  //   - une demande précédente sur LE MÊME contrat a déjà remboursé, a échoué
  //     (le remboursement a pu partir sans que la réponse n'arrive) ou est déjà
  //     en revue : relancer automatiquement rembourserait deux fois.
  if (state.manualReview) {
    finishWithdrawal(withdrawalId, { status: 'review' });
    log('billing.withdrawal_review', { userId, kind, withdrawalId, refundCents: state.refundCents });
    return res.json({
      ok: true, status: 'review', id: withdrawalId, refundCents: state.refundCents,
    });
  }

  try {
    if (MODE === 'demo') {
      // Mode démo : aucun appel à Stripe, exactement comme demoSubscribe.
      if (kind === 'pack') {
        removeCredits(userId, state.refundableCredits);
        markPackWithdrawn(state.purchaseId);
      } else {
        const current = getSubscription(userId);
        if (current) upsertSubscription({ ...current, status: 'canceled', cancel_at_period_end: 0 });
      }
      finishWithdrawal(withdrawalId, { status: 'simulated' });
      log('billing.withdrawal_simulated', { userId, kind, withdrawalId, refundCents: state.refundCents });
      return res.json({ ok: true, demo: true, status: 'simulated', id: withdrawalId, refundCents: state.refundCents });
    }

    const s = await stripe();
    let refundId = null;
    let paymentIntent = kind === 'pack' ? state.stripePaymentIntent : null;

    if (kind === 'subscription') {
      // Le PaymentIntent de la dernière facture payée : c'est lui qui porte
      // l'argent. On le relit chez Stripe plutôt que de faire confiance à la
      // copie locale, qui peut dater d'un webhook manqué.
      // API basil : `Invoice.payment_intent` n'existe plus, et `payments` n'est
      // renvoyé QUE s'il est expansé — d'où `latest_invoice.payments` et non
      // `latest_invoice` seul (sans quoi le paiement était toujours introuvable).
      const sub = await s.subscriptions.retrieve(state.stripeSubscriptionId, { expand: ['latest_invoice.payments'] });
      paymentIntent = paidPaymentIntent(sub.latest_invoice);
    }

    if (state.refundCents > 0) {
      if (!paymentIntent) throw new Error('Paiement introuvable chez Stripe : remboursement à faire à la main.');
      const refund = await s.refunds.create({
        payment_intent: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id,
        amount: state.refundCents,
        reason: 'requested_by_customer',
        metadata: { userId: String(userId), withdrawalId: String(withdrawalId), kind },
      }, {
        // Clé dérivée du CONTRAT, pas de la demande : si la réponse se perd
        // (délai dépassé) et qu'un nouvel essai part dans les 24 h, Stripe
        // renvoie le remboursement déjà créé ou refuse la requête (paramètres
        // différents) — il n'en crée jamais un second. Au-delà de 24 h, c'est
        // le passage en `review` (priorContractWithdrawal) qui protège.
        idempotencyKey: kind === 'pack' ? `withdraw:pack:${state.purchaseId}` : `withdraw:sub:${state.stripeSubscriptionId}`,
      });
      refundId = refund.id;
      // Écrit AVANT la résiliation : si celle-ci échoue, la demande partira en
      // `failed`, mais l'exploitant verra que l'argent est bien parti — sans
      // quoi il rembourserait deux fois en reprenant le dossier à la main.
      attachRefund(withdrawalId, refundId, typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null);
    }

    if (kind === 'subscription') {
      // Résiliation IMMÉDIATE, pas en fin de période : la rétractation anéantit
      // le contrat, elle ne le laisse pas courir jusqu'à son terme.
      await s.subscriptions.cancel(state.stripeSubscriptionId);
      const current = getSubscription(userId);
      if (current) upsertSubscription({ ...current, status: 'canceled', cancel_at_period_end: 0 });
    } else {
      removeCredits(userId, state.refundableCredits);
      markPackWithdrawn(state.purchaseId);
    }

    finishWithdrawal(withdrawalId, {
      status: 'refunded',
      stripe_refund_id: refundId,
      stripe_payment_intent: typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null,
    });
    log('billing.withdrawal_refunded', { userId, kind, withdrawalId, refundCents: state.refundCents, refundId });
    res.json({ ok: true, status: 'refunded', id: withdrawalId, refundCents: state.refundCents });
  } catch (err) {
    // La demande reste en base avec son calcul et son erreur : une rétractation
    // ratée techniquement reste une rétractation exercée, l'exploitant doit la
    // voir et la traiter à la main dans les 14 jours.
    finishWithdrawal(withdrawalId, { status: 'failed', error: String(err?.message || err).slice(0, 500) });
    log('billing.withdrawal_failed', { userId, kind, withdrawalId, error: String(err?.message || err) });
    next(err);
  }
}

// PaymentIntent du paiement ENCAISSÉ d'une facture (API basil). `payments`
// n'est présent que si la facture a été lue avec `expand: [...payments]` ; on
// n'y prend que l'entrée de type `payment_intent` au statut `paid` — une
// tentative `open` ou `canceled` ne porte pas d'argent à rembourser.
// Repli sur `payment_intent` (API antérieure à basil) ; sinon null, et
// l'appelant bascule en traitement manuel plutôt que de deviner.
function paidPaymentIntent(inv) {
  if (!inv || typeof inv !== 'object') return null;
  const paid = (inv.payments?.data || []).find((p) => p?.status === 'paid' && p?.payment?.type === 'payment_intent');
  const pi = paid?.payment?.payment_intent || inv.payment_intent || null;
  return typeof pi === 'string' ? pi : pi?.id || null;
}

// --- Webhook ------------------------------------------------------------------
// Corps BRUT obligatoire : la signature est calculée sur les octets. À monter
// AVANT express.json() et avant la vérification d'origine.
export const webhook = [
  raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    if (MODE === 'demo') return res.status(503).json({ error: 'mode démo' });
    let event;
    try {
      const s = await stripe();
      event = s.webhooks.constructEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.warn('[stripe] signature invalide :', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    // Dans un try : une base verrouillée ici était un rejet non rattrapé, donc
    // un arrêt du processus. Rien n'a été réservé, rien à relâcher : Stripe
    // rejouera sur le 500.
    let fresh;
    try {
      fresh = claimEvent(event.id, event.type);
    } catch (err) {
      console.error('[stripe] réservation de l’event impossible', event.type, err);
      return res.status(500).json({ error: 'hook failed' });
    }
    if (!fresh) return res.json({ received: true, duplicate: true });

    try {
      await handleEvent(event);
      res.json({ received: true });
    } catch (err) {
      console.error('[stripe] traitement échoué', event.type, err);
      releaseEvent(event.id); // laisser Stripe rejouer
      res.status(500).json({ error: 'hook failed' });
    }
  },
];

async function handleEvent(event) {
  const s = await stripe();
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return syncSubscription(event.data.object);

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const subId = inv.parent?.subscription_details?.subscription || inv.subscription;
      if (!subId) return;
      const sub = await s.subscriptions.retrieve(subId);
      // null = compte supprimé ou inconnu : rien à provisionner.
      const userId = await syncSubscription(sub);
      // Montant RÉELLEMENT encaissé : c'est la seule base honnête d'un
      // remboursement partiel. Le prix affiché de la formule ignore les codes
      // promo, les proratisations et une éventuelle TVA par pays.
      if (event.type === 'invoice.paid' && inv.amount_paid != null && userId) {
        // `payments` n'est pas expansé dans l'event : le PaymentIntent reste
        // souvent nul ici, la rétractation le relit chez Stripe de toute façon.
        setLastPayment(userId, inv.amount_paid, paidPaymentIntent(inv));
        log('billing.invoice_paid', { userId, cents: inv.amount_paid });
      }
      return;
    }

    case 'checkout.session.completed': {
      const sess = event.data.object;
      if (sess.mode === 'payment' && sess.metadata?.kind === 'pack' && sess.payment_status === 'paid') {
        const userId = Number(sess.metadata.userId) || 0;
        const credits = Number(sess.metadata.credits || 0);
        const pi = typeof sess.payment_intent === 'string' ? sess.payment_intent : sess.payment_intent?.id || null;

        // Pack payé pour un compte supprimé entre-temps (paiement terminé dans
        // un autre onglet, par exemple) : rien à créditer — la ligne est
        // pseudonymisée — donc rien à encaisser. Remboursement intégral.
        // Clé d'idempotence : un rejeu de l'event ne rembourse pas deux fois.
        if (isDeletedUser(userId)) {
          if (!pi) {
            console.error('[stripe] pack payé par un compte supprimé, PaymentIntent absent : rembourser à la main', sess.id);
            log('billing.deleted_account_pack_unrefunded', { userId, sessionId: sess.id, cents: sess.amount_total });
            return;
          }
          const refund = await s.refunds.create(
            { payment_intent: pi, metadata: { userId: String(userId), kind: 'pack', cause: 'account_deleted' } },
            { idempotencyKey: `deleted:pack:${sess.id}` },
          );
          log('billing.deleted_account_pack_refunded', { userId, sessionId: sess.id, refundId: refund.id, cents: sess.amount_total });
          return;
        }
        if (!getUser(userId)) {
          console.warn('[stripe] pack payé pour un utilisateur inconnu', sess.id);
          return;
        }

        // Trace + crédits dans une transaction, crédits conditionnés à
        // l'insertion (INSERT OR IGNORE sur stripe_session_id) : Stripe rejoue
        // ses events, et un pack compté deux fois créditerait deux fois et
        // ouvrirait deux droits de rétractation.
        const purchaseId = creditPack({
          user_id: userId,
          credits,
          paid_cents: sess.amount_total != null ? sess.amount_total : PACK_CENTS,
          stripe_session_id: sess.id,
          stripe_payment_intent: pi,
        });
        log(purchaseId ? 'billing.pack_credited' : 'billing.pack_duplicate', { userId, credits, cents: sess.amount_total });
      }
      return;
    }
    default:
      return;
  }
}

// Statuts Stripe après lesquels un abonnement ne prélèvera plus jamais.
const TERMINAL_STATUSES = new Set(['canceled', 'incomplete_expired']);

// Renvoie l'utilisateur provisionné, ou null (compte supprimé ou inconnu).
async function syncSubscription(sub) {
  const cus = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const metaId = Number(sub.metadata?.userId) || null;

  // Compte SUPPRIMÉ : `metadata.userId` est lu avant tout filtre `deleted_at`,
  // et sans ce contrôle un abonnement devenu actif après la suppression
  // (paiement terminé dans un autre onglet, event en retard) serait provisionné
  // sur une ligne pseudonymisée — et prélevé chaque mois sans plus personne
  // pour s'en plaindre. On résilie chez Stripe, on n'écrit rien.
  const deletedId = metaId ? (isDeletedUser(metaId) ? metaId : null) : getDeletedUserByCustomer(cus)?.id || null;
  if (deletedId) {
    await cancelForDeletedAccount(sub, deletedId);
    return null;
  }

  const userId = (metaId && getUser(metaId) ? metaId : null) || getUserByCustomer(cus)?.id || null;
  if (!userId) {
    console.warn('[stripe] abonnement sans utilisateur connu', sub.id);
    return null;
  }

  const plan = planFromPriceId(sub.items.data[0]?.price?.id);
  const { start, end } = periodOf(sub);
  upsertSubscription({
    user_id: userId,
    stripe_subscription_id: sub.id,
    plan_key: plan.key,
    status: sub.status,
    quota_month: plan.quota,
    period_start: start,
    period_end: end,
    cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
    // Date de CONCLUSION du contrat côté Stripe. `upsertSubscription` ne l'écrit
    // qu'une fois PAR ABONNEMENT (même `sub.id`) : elle ne bouge ni à la
    // reconduction, ni au changement de formule, sinon chaque mois rouvrirait
    // 14 jours de rétractation. Une reconduction tacite n'est pas un contrat
    // neuf ; un réabonnement (nouvel `sub.id`), si.
    subscribed_at: sub.created ? new Date(sub.created * 1000).toISOString().slice(0, 19).replace('T', ' ') : null,
  });
  log('billing.sync', { userId, plan: plan.key, status: sub.status, periodEnd: end });
  return userId;
}

async function cancelForDeletedAccount(sub, userId) {
  if (TERMINAL_STATUSES.has(sub.status)) {
    log('billing.deleted_account_event_ignored', { userId, subscriptionId: sub.id, status: sub.status });
    return;
  }
  const s = await stripe();
  // L'objet d'un event est un instantané : il peut dire `active` alors que la
  // résiliation est déjà faite (rejeu, ordre de livraison non garanti). On
  // relit avant de résilier, sinon l'erreur « déjà résilié » ferait rejouer
  // l'event en boucle.
  const current = await s.subscriptions.retrieve(sub.id);
  if (TERMINAL_STATUSES.has(current.status)) return;
  await s.subscriptions.cancel(sub.id, {}, { idempotencyKey: `deleted:sub:${sub.id}` });
  // Une facture a pu être payée avant la résiliation : elle n'est PAS
  // remboursée automatiquement ici. Le log le signale pour traitement manuel.
  log('billing.deleted_account_subscription_canceled', { userId, subscriptionId: sub.id, status: current.status });
}

export default router;
