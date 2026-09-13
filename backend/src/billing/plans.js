// Source unique des formules. Les Price IDs viennent de Stripe (Dashboard →
// Produits → un prix récurrent mensuel par formule) et se mettent dans .env.
// quota = générations réussies incluses par période de facturation.
export const PLANS = {
  free: {
    // lifetime: le quota gratuit n'est PAS mensuel — il vaut pour la vie du
    // compte, sinon créer un compte devient un abonnement gratuit permanent.
    key: 'free', label: 'Découverte', eur: 0, quota: Number(process.env.FREE_PLAN_QUOTA || 5), lifetime: true,
    pitch: "Pour essayer l'outil.",
    features: [`${Number(process.env.FREE_PLAN_QUOTA || 5)} générations au total`, 'Les 7 thèmes', 'Historique et téléchargement'],
  },
  starter: {
    key: 'starter', label: 'Starter', eur: 9.9, quota: 30, priceId: process.env.STRIPE_PRICE_STARTER,
    pitch: 'Pour un commerce, quelques visuels par semaine.',
    features: ['30 générations / mois', 'Les 7 thèmes', 'Décor personnalisé', 'Jusqu’à 6 produits par visuel'],
  },
  pro: {
    key: 'pro', label: 'Pro', eur: 24.9, quota: 100, priceId: process.env.STRIPE_PRICE_PRO, highlight: true,
    pitch: 'Pour publier régulièrement sur les réseaux.',
    features: ['100 générations / mois', 'Tout Starter', 'Relance gratuite d’un échec', 'Support par e-mail'],
  },
  studio: {
    key: 'studio', label: 'Studio', eur: 59, quota: 300, priceId: process.env.STRIPE_PRICE_STUDIO,
    pitch: 'Pour une agence ou plusieurs marques.',
    features: ['300 générations / mois', 'Tout Pro', 'Priorité de traitement'],
  },
};

// Pack de dépassement (paiement unique, crédits qui ne expirent pas).
export const PACK = { key: 'pack20', label: '20 générations', credits: 20, eur: 6, priceId: process.env.STRIPE_PRICE_PACK20 };

export const PAID_KEYS = ['starter', 'pro', 'studio'];

// Price ID Stripe → formule (utilisé par le webhook).
export function planFromPriceId(priceId) {
  return Object.values(PLANS).find((p) => p.priceId && p.priceId === priceId) || PLANS.free;
}

// Statuts Stripe qui donnent encore accès. `past_due` inclus : Stripe réessaie
// la carte quelques jours (Smart Retries) ; couper tout de suite fait fuir des
// clients qui allaient payer. `unpaid`/`canceled` → retour au plan free.
export const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// Vue publique (pas de Price ID exposé au navigateur).
export function publicPlans() {
  return Object.values(PLANS).map(({ key, label, eur, quota, lifetime, pitch, features, highlight }) => ({
    key, label, eur, quota, lifetime: !!lifetime, pitch, features, highlight: !!highlight,
  }));
}
