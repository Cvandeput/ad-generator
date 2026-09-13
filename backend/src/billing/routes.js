// Routes de facturation. Montées uniquement si BILLING_ENABLED=true.
//
// Deux modes :
//   - demo  : aucune clé Stripe → l'abonnement est simulé en base (pour voir la
//             page et tester les quotas sans compte Stripe). Rien n'est facturé.
//   - stripe: Checkout + Customer Portal + webhook signés.
import { Router, raw } from 'express';
import { config } from '../config.js';
import requireAuth from '../middleware/requireAuth.js';
import { PLANS, PACK, PAID_KEYS, publicPlans, planFromPriceId } from './plans.js';
import { quotaState } from './quota.js';
import { hasStripeKey, stripe, periodOf } from './stripe.js';
import {
  migrate, getUser, getUserByCustomer, setCustomerId, getSubscription,
  upsertSubscription, addCredits, claimEvent, releaseEvent,
} from './store.js';

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
function demoSubscribe(userId, plan) {
  const now = new Date(Date.now() + 1000);
  const end = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  upsertSubscription({
    user_id: userId, stripe_subscription_id: `demo_${userId}_${plan.key}`, plan_key: plan.key,
    status: 'active', quota_month: plan.quota, period_start: fmt(now), period_end: fmt(end), cancel_at_period_end: 0,
  });
  log('billing.demo_subscribe', { userId, plan: plan.key });
}

router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const key = String(req.body.plan || '');
    if (!PAID_KEYS.includes(key)) return res.status(400).json({ error: 'Formule inconnue' });
    const plan = PLANS[key];

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
      subscription_data: { metadata: { userId: String(req.session.userId), planKey: plan.key } },
      client_reference_id: String(req.session.userId),
    });
    log('billing.checkout', { userId: req.session.userId, plan: plan.key });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// Pack de crédits (paiement unique).
router.post('/pack', requireAuth, async (req, res, next) => {
  try {
    if (MODE === 'demo') {
      addCredits(req.session.userId, PACK.credits);
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
      metadata: { userId: String(req.session.userId), kind: 'pack', credits: String(PACK.credits) },
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
    if (!claimEvent(event.id, event.type)) return res.json({ received: true, duplicate: true });

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
      if (subId) return syncSubscription(await s.subscriptions.retrieve(subId));
      return;
    }

    case 'checkout.session.completed': {
      const sess = event.data.object;
      if (sess.mode === 'payment' && sess.metadata?.kind === 'pack' && sess.payment_status === 'paid') {
        const userId = Number(sess.metadata.userId);
        addCredits(userId, Number(sess.metadata.credits || 0));
        log('billing.pack_credited', { userId, credits: sess.metadata.credits });
      }
      return;
    }
    default:
      return;
  }
}

function syncSubscription(sub) {
  let userId = Number(sub.metadata?.userId) || null;
  if (!userId) {
    const cus = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    userId = getUserByCustomer(cus)?.id || null;
  }
  if (!userId) return console.warn('[stripe] abonnement sans utilisateur connu', sub.id);

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
  });
  log('billing.sync', { userId, plan: plan.key, status: sub.status, periodEnd: end });
}

export default router;
