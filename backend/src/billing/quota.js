// Calcul du quota. Ne contacte JAMAIS Stripe : la base est la vérité de
// l'accès (Stripe reste la vérité du paiement, recopiée par le webhook).
import { PLANS, ACTIVE_STATUSES } from './plans.js';
import { getUser, getSubscription, usedSince, consumeCredit } from './store.js';
import { isAdmin } from '../admin.js';

export function quotaState(userId) {
  const user = getUser(userId);
  // Compte administrateur : aucun décompte. Le quota sert à protéger la
  // trésorerie contre les clients, pas contre l'exploitant.
  if (isAdmin(userId)) {
    return {
      planKey: 'admin', planLabel: 'Administrateur', status: 'active',
      quota: Infinity, used: usedSince(userId, user.created_at), credits: 0,
      remaining: Infinity, exhausted: false, lifetime: false,
      periodStart: user.created_at, periodEnd: null, cancelAtPeriodEnd: false, unlimited: true,
    };
  }
  const sub = getSubscription(userId);
  const active = sub && ACTIVE_STATUSES.has(sub.status);
  const plan = active ? PLANS[sub.plan_key] || PLANS.free : PLANS.free;

  // Plan gratuit : quota "à vie" → on compte depuis la création du compte.
  const periodStart = active ? sub.period_start : user.created_at;
  const periodEnd = active ? sub.period_end : null;

  const quota = active ? sub.quota_month : plan.quota;
  const used = usedSince(userId, periodStart);
  const credits = user.extra_credits || 0;
  const remaining = Math.max(0, quota - used) + credits;

  return {
    planKey: plan.key,
    planLabel: plan.label,
    status: active ? sub.status : 'inactive',
    quota,
    used,
    credits,
    remaining,
    exhausted: remaining <= 0,
    lifetime: !!plan.lifetime,
    periodStart,
    periodEnd,
    cancelAtPeriodEnd: active ? !!sub.cancel_at_period_end : false,
  };
}

// Middleware : refuse AVANT multer (sinon on avale 14 photos de 10 Mo pour rien).
// Il décompte aussi les crédits achetés à la FIN de la requête, uniquement si
// la génération a réussi — ce qui évite de modifier routes/generate.js.
export function requireQuota(req, res, next) {
  if (!req.session?.userId) return next(); // requireAuth s'en charge plus loin
  const userId = req.session.userId;
  const s = quotaState(userId);

  if (!s.exhausted) {
    res.on('finish', () => {
      if (res.statusCode === 200) consumeCreditIfNeeded(userId);
    });
    return next();
  }
  const when = s.periodEnd ? new Date(s.periodEnd.replace(' ', 'T') + 'Z').toLocaleDateString('fr-BE') : null;
  return res.status(402).json({
    code: 'QUOTA_EXCEEDED',
    error: s.lifetime
      ? `Vos ${s.quota} générations d'essai sont utilisées. Choisissez une formule pour continuer.`
      : `Quota atteint (${s.used}/${s.quota}).${when ? ` Il se recharge le ${when}.` : ''}`,
    plan: s.planKey, used: s.used, quota: s.quota, periodEnd: s.periodEnd,
  });
}

// Après une génération réussie : si le quota d'abonnement était déjà dépassé,
// c'est un crédit acheté qui a payé.
export function consumeCreditIfNeeded(userId) {
  const s = quotaState(userId);
  if (s.used > s.quota && s.credits > 0) {
    consumeCredit(userId);
    console.log(JSON.stringify({ t: new Date().toISOString(), event: 'billing.credit_used', userId, left: s.credits - 1 }));
  }
}
