// Client Stripe chargé à la demande : si le paquet n'est pas installé ou si
// aucune clé n'est configurée, le module `billing` bascule en mode démo et le
// serveur démarre quand même.
let client = null;

export const hasStripeKey = () => /^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY || '');

export async function stripe() {
  if (client) return client;
  const { default: Stripe } = await import('stripe'); // npm i stripe
  client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-03-31.basil',
    appInfo: { name: 'AdCraft', version: '1.0.0' },
  });
  return client;
}

// `current_period_*` ne sont plus sur la subscription depuis l'API Basil :
// ils vivent sur chaque subscription item.
export function periodOf(sub) {
  const item = sub.items?.data?.[0];
  const iso = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ') : null);
  return { start: iso(item?.current_period_start ?? sub.current_period_start), end: iso(item?.current_period_end ?? sub.current_period_end) };
}
