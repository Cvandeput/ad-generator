# Abonnements Stripe + quota mensuel de générations

_13 septembre 2026. Tarifs Stripe relevés sur stripe.com/be/pricing et docs.stripe.com le 13/09/2026._

## 1. Le chiffre qui commande tout

Coût réel d'une génération, aujourd'hui :

| Poste | USD | EUR (×0,92) |
|---|---|---|
| Image `gemini-3.1-flash-image` 2K | 0,101 | 0,0929 |
| Directeur Artistique (`gemini-2.5-flash` + photos en entrée) | ~0,004 | ~0,0037 |
| **Total par génération réussie** | **~0,105** | **~0,097 €** |

Un échec ne coûte (presque) rien s'il plante avant l'appel image, mais une image renvoyée puis jugée moche coûte plein tarif. **Le quota doit compter les générations réussies, pas les factures.** Compte aussi les `pending` (sinon on peut lancer 50 requêtes en parallèle et toutes passent le contrôle avant qu'une seule ne soit marquée `done`).

Frais Stripe Belgique (prélevés sur chaque paiement) :

| | Taux |
|---|---|
| Carte standard EEA | **1,5 % + 0,25 €** |
| Carte « premium » EEA (corporate, certaines cartes crédit) | 2,8 % + 0,25 € |
| Carte UK / internationale | 2,5 % / 3,15 % + 0,25 € |
| Conversion de devise | +2 % |
| Bancontact | **0,35 € fixe** (intéressant en BE, mais [récurrent = via SEPA mandat](https://docs.stripe.com/payments/bancontact)) |
| Stripe **Billing** (abonnements) | **+0,7 % du volume facturé** |
| Stripe Tax (calcul TVA automatique) | +0,5 % par transaction (ou 0,45 €/transaction en API) |

Donc sur un abonnement carte EEA : **~2,2 % + 0,25 €** par paiement mensuel. Sur 9,90 € → 0,47 €.

## 2. Paliers proposés (marge visée ≥ 50 %)

| Palier | Prix / mois | Quota | Coût IA | Frais Stripe | **Marge** | Coût réel d'une image pour le client |
|---|---|---|---|---|---|---|
| Découverte | 0 € | **5 générations à vie** (pas par mois) | 0,48 € une fois | 0 | −0,48 € (acquisition) | — |
| **Starter** | 9,90 € | 30 / mois | 2,90 € | 0,47 € | **6,53 € (66 %)** | 0,33 € |
| **Pro** | 24,90 € | 100 / mois | 9,66 € | 0,80 € | **14,44 € (58 %)** | 0,25 € |
| **Studio** | 59 € | 300 / mois | 28,98 € | 1,55 € | **28,47 € (48 %)** | 0,20 € |

Le piège à éviter : plus le palier est gros, plus la marge % s'écrase (59 € / 500 générations = 15 % de marge, et 0 € si le client consomme tout avec `gemini-3-pro-image`). Garde le rapport prix/quota au-dessus de **0,20 €/génération**, c'est-à-dire ~2× le coût.

Deux leviers en plus :

- **Annuel à −2 mois** : 99 €/an (Starter) → marge 61,80 € même quota plein, et un seul frais fixe de 0,25 € au lieu de 12.
- **Dépassement** au lieu du blocage sec : pack de 20 générations à 6 € (0,30 €/gen), en paiement unique. Techniquement c'est un `mode: 'payment'` Checkout qui crédite `extra_credits` en base — pas un abonnement, donc pas de complexité de facturation à l'usage.

La quasi-totalité des clients ne consommera pas son quota : la marge réelle sera plus haute que ces lignes, qui sont le **pire cas**.

## 3. Architecture

```
Front                    Backend Express                     Stripe
─────                    ───────────────                     ──────
[Choisir Pro] ─POST /api/billing/checkout──▶ checkout.sessions.create ──▶ redirection
                                                                          checkout.stripe.com
                                                                                │ paiement
       ◀───────────── retour /app.html?checkout=success ◀────────────────────────┘
                                                                                │
                         POST /api/billing/webhook  ◀──── customer.subscription.created/updated
                         (upsert plan + période)          invoice.paid / payment_failed
                                                          customer.subscription.deleted

[Gérer mon abo] ─POST /api/billing/portal──▶ billingPortal.sessions.create ──▶ billing.stripe.com
                                                        (changer de carte, upgrade, annuler, factures)

POST /api/generate ──▶ quota = plan.quota − COUNT(generations WHERE user AND created ≥ period_start)
```

Trois principes :

1. **Stripe est la source de vérité du paiement, ta base est la source de vérité de l'accès.** Tu ne rappelles jamais l'API Stripe pendant une génération (latence + panne Stripe = plus de génération). Le webhook écrit `plan`, `status`, `period_start`, `period_end` dans SQLite ; `/api/generate` ne lit que SQLite.
2. **Le quota se remet à zéro sur la période de facturation, pas le 1er du mois.** Un client qui paie le 17 a son quota qui repart le 17. Sinon quelqu'un qui s'abonne le 30 a deux quotas en deux jours.
3. **Rien ne se décide côté client.** Le front affiche « 12/100 » mais c'est le backend qui refuse la 101ᵉ.

### Entitlements ou pas ?

Stripe a une API [Entitlements](https://docs.stripe.com/api/entitlements/active-entitlement/list) (features attachées aux produits, event `entitlements.active_entitlement_summary.updated`). C'est fait pour du feature flag ON/OFF multi-produits. Pour **un seul axe numérique** (quota/mois), c'est un aller-retour réseau en plus pour rien : mets le quota dans la **metadata du Price** (`quota_month=100`) et recopie-le en base au webhook. Tu gardes Entitlements en tête si un jour tu vends des options (4K, marque blanche, API).

## 4. Schéma de base à ajouter

```sql
-- users
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;          -- cus_...
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

-- abonnement courant (1 ligne par user, écrasée par le webhook)
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  plan_key             TEXT NOT NULL DEFAULT 'free',   -- free | starter | pro | studio
  status               TEXT NOT NULL DEFAULT 'inactive',
  quota_month          INTEGER NOT NULL DEFAULT 5,
  period_start         TEXT,                            -- ISO, début de la période de facturation
  period_end           TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- crédits achetés à l'unité (packs de dépassement)
ALTER TABLE users ADD COLUMN extra_credits INTEGER NOT NULL DEFAULT 0;

-- idempotence des webhooks : Stripe rejoue le même event en cas d'erreur
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,          -- evt_...
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Le plan `free` avec `period_start = date d'inscription` et `period_end = NULL` donne les 5 générations à vie sans cas particulier dans le code.

## 5. Code

### `backend/src/plans.js` — source unique des paliers

```js
// Les Price IDs viennent de Stripe (Dashboard → Produits). Un par palier, mensuel.
// quota = générations réussies par période de facturation.
export const PLANS = {
  free:    { key: 'free',    label: 'Découverte', quota: 5,   priceId: null,                          eur: 0 },
  starter: { key: 'starter', label: 'Starter',    quota: 30,  priceId: process.env.STRIPE_PRICE_STARTER, eur: 9.9 },
  pro:     { key: 'pro',     label: 'Pro',        quota: 100, priceId: process.env.STRIPE_PRICE_PRO,     eur: 24.9 },
  studio:  { key: 'studio',  label: 'Studio',     quota: 300, priceId: process.env.STRIPE_PRICE_STUDIO,  eur: 59 },
};
export const PACK = { priceId: process.env.STRIPE_PRICE_PACK20, credits: 20, eur: 6 };

// Price ID Stripe → palier (utilisé par le webhook).
export function planFromPriceId(priceId) {
  return Object.values(PLANS).find((p) => p.priceId && p.priceId === priceId) || PLANS.free;
}
// Un abonnement donne accès tant qu'il est dans un de ces états.
export const ACTIVE = new Set(['active', 'trialing', 'past_due']);
```

`past_due` dans la liste : Stripe réessaie la carte pendant quelques jours (Smart Retries), couper l'accès immédiatement pour une carte expirée fait fuir des clients qui allaient payer. `unpaid` et `canceled` → retour au plan `free`.

### `backend/src/quota.js` — le contrôle

```js
import db from './db.js';
import { PLANS, ACTIVE } from './plans.js';

// Abonnement effectif d'un utilisateur (jamais null : repli sur `free`).
export function subscriptionOf(userId) {
  const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (!row || !ACTIVE.has(row.status)) {
    const user = db.prepare('SELECT created_at, extra_credits FROM users WHERE id = ?').get(userId);
    return { planKey: 'free', quota: PLANS.free.quota, periodStart: user.created_at, periodEnd: null,
             status: row?.status || 'inactive', extraCredits: user.extra_credits, cancelAtPeriodEnd: false };
  }
  const user = db.prepare('SELECT extra_credits FROM users WHERE id = ?').get(userId);
  return { planKey: row.plan_key, quota: row.quota_month, periodStart: row.period_start,
           periodEnd: row.period_end, status: row.status, extraCredits: user.extra_credits,
           cancelAtPeriodEnd: !!row.cancel_at_period_end };
}

// Consommation de la période courante. `pending` compte : sinon N requêtes
// simultanées passent toutes le contrôle avant qu'une seule ne soit `done`.
export function usedIn(userId, periodStart) {
  return db.prepare(
    `SELECT COUNT(*) n FROM generations
     WHERE user_id = ? AND status IN ('done','pending') AND created_at >= ?`
  ).get(userId, periodStart).n;
}

export function quotaState(userId) {
  const sub = subscriptionOf(userId);
  const used = usedIn(userId, sub.periodStart);
  const remaining = Math.max(0, sub.quota - used) + sub.extraCredits;
  return { ...sub, used, remaining, exhausted: remaining <= 0 };
}

// Consomme un crédit acheté quand le quota d'abonnement est épuisé.
export function consumeExtraCreditIfNeeded(userId) {
  const s = quotaState(userId);
  if (s.used >= s.quota && s.extraCredits > 0) {
    db.prepare('UPDATE users SET extra_credits = extra_credits - 1 WHERE id = ? AND extra_credits > 0').run(userId);
  }
}
```

Dans `routes/generate.js`, juste après `requireAuth` et avant `upload` (refuser **avant** d'avoir avalé 14 photos de 10 Mo) :

```js
import { quotaState, consumeExtraCreditIfNeeded } from '../quota.js';

function requireQuota(req, res, next) {
  const s = quotaState(req.session.userId);
  if (s.exhausted) {
    return res.status(402).json({           // 402 Payment Required : le front sait ouvrir la page d'abo
      error: s.planKey === 'free'
        ? `Vos ${s.quota} générations d'essai sont utilisées. Choisissez une formule pour continuer.`
        : `Quota atteint (${s.used}/${s.quota}). Il se recharge le ${new Date(s.periodEnd).toLocaleDateString('fr-BE')}.`,
      code: 'QUOTA_EXCEEDED', plan: s.planKey, used: s.used, quota: s.quota, periodEnd: s.periodEnd,
    });
  }
  next();
}

router.post('/generate', requireAuth, requireQuota, hourly, daily, upload.array('images', MAX_IMAGES), async (req, res) => { /* … */ });
// et après un performGeneration réussi :  consumeExtraCreditIfNeeded(req.session.userId);
```

### `backend/src/routes/billing.js`

```js
import { Router, raw } from 'express';
import Stripe from 'stripe';
import db from '../db.js';
import { config } from '../config.js';
import requireAuth from '../middleware/requireAuth.js';
import { PLANS, PACK, planFromPriceId } from '../plans.js';
import { quotaState } from '../quota.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
const router = Router();
const origin = () => config.allowedOrigins[0] || 'http://localhost:3000';

// Crée (ou retrouve) le client Stripe de l'utilisateur.
async function customerFor(userId) {
  const user = db.prepare('SELECT id, email, stripe_customer_id FROM users WHERE id = ?').get(userId);
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe.customers.create({ email: user.email, metadata: { userId: String(user.id) } });
  db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(c.id, user.id);
  return c.id;
}

router.get('/plans', (_req, res) => {
  res.json({ plans: Object.values(PLANS).map(({ key, label, quota, eur }) => ({ key, label, quota, eur })), pack: { credits: PACK.credits, eur: PACK.eur } });
});

router.get('/subscription', requireAuth, (req, res) => res.json(quotaState(req.session.userId)));

// Abonnement : Checkout hébergé par Stripe (aucune donnée de carte ne touche ton serveur).
router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const plan = PLANS[String(req.body.plan || '')];
    if (!plan || !plan.priceId) return res.status(400).json({ error: 'Formule inconnue' });
    const customer = await customerFor(req.session.userId);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${origin()}/app.html?checkout=success`,
      cancel_url: `${origin()}/tarifs.html?checkout=cancel`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },                     // exige Stripe Tax activé
      customer_update: { address: 'auto', name: 'auto' },
      subscription_data: { metadata: { userId: String(req.session.userId), planKey: plan.key } },
      // trial_period_days: 7,                              // si tu veux un essai
    });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// Pack de crédits (paiement unique).
router.post('/pack', requireAuth, async (req, res, next) => {
  try {
    const customer = await customerFor(req.session.userId);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: [{ price: PACK.priceId, quantity: 1 }],
      success_url: `${origin()}/app.html?pack=success`,
      cancel_url: `${origin()}/app.html?pack=cancel`,
      automatic_tax: { enabled: true },
      metadata: { userId: String(req.session.userId), kind: 'pack', credits: String(PACK.credits) },
    });
    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// Portail : changement de carte, upgrade/downgrade, annulation, factures. Zéro UI à écrire.
router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    const customer = await customerFor(req.session.userId);
    const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin()}/app.html` });
    res.json({ url: s.url });
  } catch (err) { next(err); }
});

// --- Webhook : corps BRUT obligatoire (signature calculée sur les octets) -----
export const webhook = [
  raw({ type: 'application/json' }),
  async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.warn('[stripe] signature invalide :', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    // Idempotence : Stripe rejoue l'event si on ne répond pas 2xx.
    const seen = db.prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)').run(event.id, event.type);
    if (seen.changes === 0) return res.json({ received: true, duplicate: true });

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await upsertSubscription(event.data.object);
          break;
        case 'invoice.paid':            // renouvellement : la période a bougé
        case 'invoice.payment_failed': {
          const subId = event.data.object.parent?.subscription_details?.subscription
                     || event.data.object.subscription;           // < API 2025-03-31
          if (subId) await upsertSubscription(await stripe.subscriptions.retrieve(subId));
          break;
        }
        case 'checkout.session.completed': {
          const s = event.data.object;
          if (s.mode === 'payment' && s.metadata?.kind === 'pack' && s.payment_status === 'paid') {
            db.prepare('UPDATE users SET extra_credits = extra_credits + ? WHERE id = ?')
              .run(Number(s.metadata.credits || 0), Number(s.metadata.userId));
          }
          break;
        }
      }
      res.json({ received: true });
    } catch (err) {
      console.error('[stripe] traitement échoué', event.type, err);
      db.prepare('DELETE FROM stripe_events WHERE id = ?').run(event.id);   // laisser Stripe rejouer
      res.status(500).json({ error: 'hook failed' });
    }
  },
];

async function upsertSubscription(sub) {
  // userId : metadata posée au checkout, sinon on remonte par le customer.
  let userId = Number(sub.metadata?.userId) || null;
  if (!userId) {
    const row = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(typeof sub.customer === 'string' ? sub.customer : sub.customer.id);
    userId = row?.id;
  }
  if (!userId) return console.warn('[stripe] abonnement sans utilisateur', sub.id);

  const item = sub.items.data[0];                 // ⚠ current_period_* vit ICI depuis l'API Basil
  const plan = planFromPriceId(item.price.id);
  const iso = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ') : null);

  db.prepare(`
    INSERT INTO subscriptions (user_id, stripe_subscription_id, plan_key, status, quota_month, period_start, period_end, cancel_at_period_end, updated_at)
    VALUES (?,?,?,?,?,?,?,?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      stripe_subscription_id=excluded.stripe_subscription_id, plan_key=excluded.plan_key, status=excluded.status,
      quota_month=excluded.quota_month, period_start=excluded.period_start, period_end=excluded.period_end,
      cancel_at_period_end=excluded.cancel_at_period_end, updated_at=datetime('now')
  `).run(userId, sub.id, plan.key, sub.status, plan.quota,
         iso(item.current_period_start), iso(item.current_period_end), sub.cancel_at_period_end ? 1 : 0);
  console.log(JSON.stringify({ t: new Date().toISOString(), event: 'billing.sync', userId, plan: plan.key, status: sub.status }));
}

export default router;
```

### `backend/src/server.js` — l'ordre compte

```js
import billingRoutes, { webhook as stripeWebhook } from './routes/billing.js';

// AVANT express.json() et AVANT csrfOrigin : le webhook a besoin du corps brut
// et n'a pas d'en-tête Origin.
app.post('/api/billing/webhook', ...stripeWebhook);

app.use(express.json({ limit: '64kb' }));
app.use('/api', csrfOrigin);
// …
app.use('/api/billing', billingRoutes);
```

## 6. Les six pièges

1. **`current_period_end` n'est plus sur la subscription.** Depuis l'API `2025-03-31.basil` il vit sur `subscription.items.data[0].current_period_end`. Le code qui lit `sub.current_period_end` récupère `undefined` → période nulle → quota jamais réinitialisé. ([changelog](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end))
2. **Corps brut du webhook.** Si `express.json()` passe avant, la signature ne vérifie plus jamais. Monte la route avant, avec `express.raw({type:'application/json'})`.
3. **Idempotence.** Stripe rejoue un event tant qu'il n'a pas de 2xx (jusqu'à 3 jours). Sans table `stripe_events`, un pack de crédits peut être crédité deux fois.
4. **Ne jamais faire confiance au `success_url`.** L'utilisateur peut l'ouvrir à la main. L'accès se provisionne **uniquement** au webhook.
5. **Répondre 2xx vite.** Si tu fais un traitement long dans le webhook, Stripe retente et, pour `invoice.created`, retarde la finalisation des factures jusqu'à 72 h.
6. **CSP.** Checkout et le Portail sont des redirections plein écran : rien à changer. Si tu passes un jour à Checkout embarqué ou à la Pricing Table, il faut ajouter `script-src https://js.stripe.com` et `frame-src https://js.stripe.com https://checkout.stripe.com` dans `nginx/snippets/adcraft-security.conf` et dans helmet.

## 7. Tester sans payer

```bash
npm i stripe
npm i -g stripe            # CLI
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook   # affiche whsec_… → STRIPE_WEBHOOK_SECRET
# dans un autre terminal :
stripe trigger customer.subscription.created
stripe trigger invoice.paid
```
Carte de test : `4242 4242 4242 4242`, date future, CVC libre. Carte qui échoue au renouvellement : `4000 0000 0000 0341`.

Pour vérifier la remise à zéro du quota sans attendre un mois : **Test Clocks** (Dashboard → Sandbox → Test clocks, ou `stripe test_helpers test_clocks advance`). Crée un client sur l'horloge, abonne-le, avance de 31 jours, vérifie que `period_start` a bougé et que le compteur repart à 0.

## 8. Variables d'environnement à ajouter

```
STRIPE_SECRET_KEY=sk_live_…            # sk_test_… en sandbox
STRIPE_WEBHOOK_SECRET=whsec_…          # donné par `stripe listen` ou le Dashboard
STRIPE_PRICE_STARTER=price_…
STRIPE_PRICE_PRO=price_…
STRIPE_PRICE_STUDIO=price_…
STRIPE_PRICE_PACK20=price_…
```
Même traitement que `SESSION_SECRET` dans `config.js` : refus de démarrer en production si `STRIPE_SECRET_KEY` est vide alors que la facturation est activée.

## 9. Front — ce qu'il reste à écrire

- `tarifs.html` : 3 cartes, bouton → `POST /api/billing/checkout` → `location.href = url`.
- Dans le studio : sous le bouton Générer, remplacer « ≈ 0,093 € par visuel » par **« 12 / 100 générations ce mois · se recharge le 17/10 »** (`GET /api/billing/subscription`).
- Gérer le `402` de `/api/generate` : afficher le message + un bouton « Voir les formules ».
- Un lien « Gérer mon abonnement » dans la navbar → `POST /api/billing/portal`. Tu n'écris **aucune** page de facturation, d'annulation ou de changement de carte : le portail Stripe fait tout, y compris les factures PDF.
- `legal.html` : ajouter les conditions de vente (prix, durée, reconduction tacite, **droit de rétractation de 14 jours** et sa renonciation pour un service numérique exécuté immédiatement, remboursement, résiliation).

## 10. Côté administratif (à vérifier avec un comptable — je ne suis ni juriste ni comptable)

Encaisser des abonnements récurrents en Belgique, c'est une activité commerciale : ça suppose un numéro d'entreprise (BCE) et, en tant qu'étudiant, le statut **étudiant-indépendant** (cotisations sociales réduites sous seuil de revenus, à demander à une caisse d'assurances sociales avant de facturer). Stripe demandera ces informations à l'activation du compte.

TVA : un abonnement SaaS vendu à un particulier d'un autre pays de l'UE est un **service numérique B2C**, taxable dans le pays du client dès que le total de ces ventes dépasse **10 000 €/an** (en dessous, TVA belge). Au-delà, on déclare via le guichet unique **OSS**. Deux façons de s'en sortir : activer **Stripe Tax** (+0,5 %/transaction, calcule et applique le bon taux, sort les rapports) ou rester sous le seuil et facturer la TVA belge. Le régime de la **franchise de TVA** (< 25 000 € de chiffre d'affaires) existe en Belgique mais ne dispense pas des règles OSS pour les ventes hors BE. À trancher avec un comptable **avant** de mettre les prix en ligne, parce que « prix TTC ou HT » change la marge de 21 %.

## 11. Ordre d'exécution

1. Décider prix + quotas (§2) et si tu veux un essai gratuit.
2. Compte Stripe en **sandbox** : créer 3 produits + 1 prix mensuel chacun, + 1 prix unique pour le pack. Noter les `price_…`.
3. Activer le **Customer Portal** (Dashboard → Settings → Billing → Customer portal) : autoriser changement de formule (les 3 produits), annulation en fin de période, factures.
4. Migration SQL (§4) + `plans.js`, `quota.js`, `billing.js`, montage dans `server.js` (§5).
5. `stripe listen` + `stripe trigger` : vérifier qu'un abonnement crée bien la ligne `subscriptions` et que `/api/generate` renvoie 402 une fois le quota dépassé.
6. Test Clock : avancer d'un mois, vérifier la remise à zéro.
7. Front : `tarifs.html`, compteur dans le studio, gestion du 402, lien portail.
8. CGV + statut/TVA (§9, §10).
9. Passage en **live** : nouvelles clés, nouveau webhook endpoint (`https://ads.devwork.cloud/api/billing/webhook`), re-créer les produits en mode live (les IDs de sandbox n'existent pas en live).

## Sources

- Tarifs Belgique : https://stripe.com/be/pricing
- Webhooks d'abonnement et statuts : https://docs.stripe.com/billing/subscriptions/webhooks
- `current_period_*` déplacé sur les items : https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end
- Objet Subscription : https://docs.stripe.com/api/subscriptions/object
- Cycle de facturation / ancrage : https://docs.stripe.com/billing/subscriptions/billing-cycle
- Customer Portal : https://docs.stripe.com/customer-management
- Entitlements : https://docs.stripe.com/api/entitlements/active-entitlement/list

---

# Prototype livré (13/09/2026)

Tout est **désactivé par défaut** : sans `BILLING_ENABLED=true`, aucun module de facturation n'est chargé, `/api/billing/*` répond 404 et `/api/generate` se comporte exactement comme avant. Vérifié : backend démarré sans la variable → aucune route montée, aucun quota appliqué.

## Fichiers

| Fichier | |
|---|---|
| `backend/src/billing/plans.js` | Formules, quotas, mapping Price ID → formule |
| `backend/src/billing/store.js` | Migration additive (colonnes + tables) et requêtes |
| `backend/src/billing/quota.js` | Calcul du quota + middleware `requireQuota` (402) |
| `backend/src/billing/stripe.js` | Client Stripe en import dynamique + lecture de la période (API Basil) |
| `backend/src/billing/routes.js` | `/plans` `/subscription` `/checkout` `/pack` `/portal` `/cancel` + webhook signé |
| `frontend/tarifs.html`, `frontend/js/tarifs.js` | La page tarifs |
| `backend/src/server.js` | **Seule modification** : un bloc `if (BILLING)` (import dynamique, webhook en corps brut, montage des routes) |
| `frontend/js/{api,nav,app}.js` | Ajouts : espace `api.billing`, lien « Tarifs » si l'API répond, écran « Quota atteint » sur 402 |

`routes/generate.js` **n'est pas modifié** : le quota est un middleware monté devant `/api/generate` dans `server.js`, et les crédits achetés sont décomptés sur l'événement `finish` de la réponse, uniquement si le statut est 200.

## Mode démo (sans compte Stripe)

Sans `STRIPE_SECRET_KEY`, le module démarre en **mode démo** : les boutons créent l'abonnement directement en base (30 jours), le pack crédite 20 générations, rien n'appelle Stripe et rien n'est facturé. La page l'affiche en bandeau. C'est fait pour tester les quotas et l'ergonomie avant d'ouvrir un compte.

```bash
# dans .env
BILLING_ENABLED=true
# puis
cd backend && npm start        # → http://localhost:3000/tarifs.html
```

Testé de bout en bout : 5 générations gratuites → la 6ᵉ renvoie 402 avec l'écran « Quota atteint » et le bouton vers les formules → souscription Pro → quota 100, compteur remis à 0, recharge affichée au 13 octobre.

## Passage en mode Stripe

```bash
cd backend && npm install stripe     # met aussi package-lock.json à jour (nécessaire pour `npm ci` du Dockerfile)
```
puis dans `.env` : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, et les 4 `STRIPE_PRICE_*`. Le module bascule tout seul (`💳 Facturation activée (mode stripe)` au démarrage).

Testé avec des clés factices et des webhooks signés localement (`stripe.webhooks.generateTestHeaderString`) :

```
signature invalide      : 400 Webhook Error: No signatures found matching…
subscription.created    : 200 {"received":true}
rejeu du même event     : 200 {"received":true,"duplicate":true}     ← idempotence
updated (studio)        : 200  → plan_key passe à studio, quota 300
résiliation programmée  : 200  → cancel_at_period_end = 1
checkout pack payé      : 200  → +20 crédits
subscription.deleted    : 200  → retour au plan free
```
Vérifié aussi : une génération en échec (502) ne consomme **pas** de crédit, et un POST `/api/billing/checkout` avec `Origin: https://evil.example` est refusé en 403 par le middleware d'origine.

## Parcours d'inscription (13/09)

L'inscription est **ouverte** (`REGISTER_MODE=open`, nouveau défaut) et ne demande plus de code d'invitation :

```
/register.html  →  compte créé sur la formule gratuite (FREE_PLAN_QUOTA générations à vie)
                →  redirection /tarifs.html?bienvenue=1
                   « Bienvenue — choisissez votre formule »
                   ├─ Continuer en gratuit      → /app.html
                   └─ Choisir Starter/Pro/Studio → Stripe Checkout → retour ?checkout=success
                                                   (c'est le webhook qui provisionne)
```

Sur cette page d'accueil post-inscription, le bloc « votre formule » est masqué (afficher « 0 / 5 utilisées » à quelqu'un qui vient de s'inscrire n'apporte rien) et la carte gratuite devient une vraie sortie « Continuer en gratuit ». Le reste du temps, la page redevient une page tarifs classique.

`FREE_PLAN_QUOTA=0` supprime l'essai : le compte est créé, mais la première génération renvoie 402 tant qu'aucun abonnement n'est pris. Testé.

**Le revers** : n'importe qui peut créer autant de comptes qu'il veut et cumuler les quotas gratuits (5 générations ≈ 0,48 € par compte). Garde-fous actuels : quota gratuit **à vie** et non mensuel, 5 inscriptions/h/IP, 20 générations/h et 60/jour par compte. Avant d'ouvrir le site au public, ajoute une **vérification d'e-mail** avant d'accorder le quota gratuit — c'est le seul garde-fou qui coupe vraiment la création en masse.

## Ce qu'il reste avant d'encaisser pour de vrai

1. Créer les produits/prix dans Stripe (sandbox d'abord) et remplir les `STRIPE_PRICE_*`.
2. Activer le Customer Portal dans le Dashboard (sinon `/portal` renvoie une erreur Stripe).
3. `stripe listen --forward-to localhost:3000/api/billing/webhook` pour récupérer le `whsec_…`, puis en prod créer l'endpoint `https://ads.devwork.cloud/api/billing/webhook` (events : `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`).
4. Décommenter `automatic_tax` dans `routes.js` une fois Stripe Tax configuré.
5. CGV dans `legal.html` (prix, reconduction, rétractation 14 jours et sa renonciation, remboursement).
6. Statut indépendant + TVA (§10).

---

# Vérification d'e-mail (13/09)

Le trou laissé par l'inscription ouverte est fermé : **un compte non confirmé n'a aucune génération**. C'est le garde-fou qui manquait ; le quota ne fait que borner le coût par compte, il n'empêche pas d'en créer mille.

## Comment ça marche

```
/register.html → compte créé, email_verified = 0, e-mail envoyé
               → /tarifs.html?bienvenue=1&verif=1  (bandeau rouge « confirmez votre adresse »)
POST /api/generate → 403 EMAIL_NOT_VERIFIED tant que ce n'est pas fait
lien de l'e-mail → /verify.html?token=… → POST /api/auth/verify-email → email_verified = 1
```

- Le jeton fait 32 octets aléatoires en base64url ; la base ne stocke que son **SHA-256**, donc une fuite de `app.db` ne permet ni d'activer un compte ni de le détourner. Usage unique, 24 h (`EMAIL_VERIFICATION_TTL_HOURS`), et un renvoi invalide le précédent.
- Le jeton est retiré de la barre d'adresse après usage (`history.replaceState`), pour qu'il ne traîne pas dans l'historique du navigateur.
- **Un abonné payant n'est jamais bloqué** : quelqu'un qui a donné une carte n'est pas un robot, et lui refuser le service serait absurde.
- Renvoi limité à **3/h par IP**, réponse toujours neutre (« si un compte non confirmé existe pour cette adresse… ») pour ne pas transformer l'endpoint en détecteur de comptes.
- Les comptes qui existaient avant la migration sont marqués vérifiés automatiquement, et les comptes de `SEED_USERS` sont créés vérifiés : personne ne se retrouve enfermé dehors.
- Sans `SMTP_HOST`, la vérification est **désactivée** (et le démarrage affiche un avertissement si l'inscription est ouverte). Si on la force à `true` sans SMTP, le backend refuse de démarrer en production — sinon plus personne ne peut activer son compte.

## Configuration

```bash
cd backend && npm install nodemailer     # met aussi package-lock.json à jour (npm ci du Dockerfile)
```
```
SMTP_HOST=postfix          # le Postfix du VPS (réseau docker mail-shared-network)
SMTP_PORT=25
SMTP_FROM=AdCraft <noreply@ads.devwork.cloud>
# SMTP_USER / SMTP_PASS pour un service transactionnel
# SMTP_TLS_REJECT_UNAUTHORIZED=false   si certificat auto-signé
EMAIL_VERIFICATION_TTL_HOURS=24
```
Le conteneur backend doit être sur le réseau `mail-shared-network` pour joindre `postfix` par son nom (c'est déjà le cas sur BelleMontreWallone). Sinon : `SMTP_HOST=host.docker.internal`.

**Délivrabilité** : un e-mail envoyé depuis un VPS sans SPF/DKIM/DMARC part en indésirables une fois sur deux. Vérifie les enregistrements DNS du domaine expéditeur, ou passe par un service transactionnel (les offres gratuites tournent autour de 100 e-mails/jour, largement au-dessus du besoin ici).

## Tests effectués

```
inscription                        → emailVerified: false, verificationRequired: true
e-mail reçu (SMTP local de test)   → sujet, texte et HTML contiennent le même lien
génération avant confirmation      → 403 EMAIL_NOT_VERIFIED
jeton bidon                        → 400 INVALID_TOKEN
bon jeton                          → ok, emailVerified: true
rejeu du même jeton                → 400 (usage unique)
génération après confirmation      → 200
renvoi sur adresse inconnue        → 202, message neutre
4 renvois depuis la même IP        → 202 202 202 429
jeton en clair présent en base     → non (SHA-256 uniquement)
```
Parcours navigateur vérifié : bandeau rouge « Confirmez votre adresse » avec bouton de renvoi sur toutes les pages, écran dédié dans le studio, page `/verify.html` en succès et en échec, bandeau qui disparaît après confirmation.

## Ce qui reste possible pour un attaquant déterminé

Créer des comptes avec des adresses jetables. Si ça arrive : bloquer les domaines jetables (liste publique) dans `EMAIL_RE`, ou passer `FREE_PLAN_QUOTA=0` et vendre uniquement des abonnements. Le captcha n'arrive qu'après, il coûte cher en conversion.
