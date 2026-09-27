// Page d'accueil : chrome commun (nav connectée ou non, footer, cookies),
// appels à l'action selon l'état du visiteur, aperçu des tarifs.
import { mountChrome } from './nav.js';
import { api } from './api.js';
import { t, has, money } from './i18n.js';
import { escapeHtml } from './components.js';

// Accusé de suppression de compte. La redirection arrive ici parce qu'après la
// suppression il n'y a plus ni session ni compte : aucune page privée ne peut
// afficher le message. Sans lui, l'utilisateur se retrouve déconnecté sans
// savoir si son geste a abouti — la pire fin possible pour une action
// irréversible.
if (new URLSearchParams(location.search).get('compte') === 'supprime') {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.className = 'w-full max-w-container-max mx-auto px-lg pt-lg';
  el.innerHTML = `<div class="bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(t('account.delete.doneNotice'))}</div>`;
  document.getElementById('site-header')?.insertAdjacentElement('afterend', el);
  history.replaceState(null, '', '/');
}

// --- Quota offert à l'inscription -------------------------------------------
// Valeur servie par GET /api/auth/config (freeQuota = FREE_PLAN_QUOTA). 5 tant
// que la réponse n'est pas arrivée, ou si un backend plus ancien ne l'expose pas.
const DEFAULT_FREE_QUOTA = 5;
const readQuota = (cfg) => {
  const q = Number(cfg && cfg.freeQuota);
  return Number.isInteger(q) && q >= 0 ? q : DEFAULT_FREE_QUOTA;
};

// Textes qui dépendent du quota : data-quota-i18n="cle" → t(cle, { count }).
// L'hydratation générique (data-i18n) ne sait pas passer de variable, d'où cet
// attribut dédié. Liste blanche explicite : les clés restent visibles pour
// tools/check-i18n.mjs. Appelé tout de suite (avant le premier affichage) puis
// à l'arrivée de la configuration.
const QUOTA_TEXTS = {
  'home.cta.offer': (count) => t('home.cta.offer', { count }),
  'home.faq.a1': (count) => t('home.faq.a1', { count }),
};
function applyQuota(count) {
  document.querySelectorAll('[data-quota-i18n]').forEach((el) => {
    const text = QUOTA_TEXTS[el.dataset.quotaI18n];
    if (text) el.textContent = text(count);
  });
}
applyQuota(DEFAULT_FREE_QUOTA);

// --- Appels à l'action --------------------------------------------------------
// Le HTML décrit l'état le plus courant (visiteur sans compte, inscription
// ouverte). On ne promet un essai gratuit que s'il existe vraiment :
//   studio  → connecté : « Ouvrir le studio » ;
//   trial   → inscription ouverte et quota offert > 0 : « Essayer gratuitement » ;
//   signup  → inscription ouverte, quota offert nul : « Créer un compte » ;
//   invite  → inscription sur code : « Se connecter » + lien pour les invités ;
//   closed  → inscription fermée (ou config injoignable) : « Se connecter ».
const CTA = {
  studio: { href: '/app.html', label: () => t('home.hero.ctaStudio') },
  trial: { href: '/register.html', label: () => t('home.cta.try') },
  signup: { href: '/register.html', label: () => t('home.cta.signup') },
  invite: { href: '/login.html', label: () => t('home.cta.login') },
  closed: { href: '/login.html', label: () => t('home.cta.login') },
};

function ctaState(user, cfg, quota) {
  if (user) return 'studio';
  const mode = (cfg && cfg.registerMode) || 'closed';
  if (mode === 'open') return quota > 0 ? 'trial' : 'signup';
  return mode === 'invite' ? 'invite' : 'closed';
}

const show = (el, visible) => el.classList.toggle('hidden', !visible);

function applyCta(state) {
  const { href, label } = CTA[state];
  // On cible par data-cta, pas par libellé : celui-ci est traduit.
  document.querySelectorAll('a[data-cta="primary"]').forEach((a) => {
    a.setAttribute('href', href);
    a.textContent = label();
  });
  document.querySelectorAll('[data-cta-offer]').forEach((el) => show(el, state === 'trial'));
  document.querySelectorAll('[data-cta-login]').forEach((el) => show(el, state === 'trial' || state === 'signup'));
  document.querySelectorAll('[data-cta-invite]').forEach((el) => show(el, state === 'invite'));
  // Ligne de mentions vide (connecté, inscription fermée) : on la retire pour
  // ne pas laisser un espacement orphelin sous le bouton.
  document.querySelectorAll('[data-cta-notes]').forEach((el) => {
    show(el, [...el.children].some((c) => !c.classList.contains('hidden')));
  });
  // FAQ « carte bancaire / essai » : sans objet si l'essai n'est pas proposé.
  document.querySelectorAll('[data-needs="trial"]').forEach((el) => show(el, state === 'trial'));
}

Promise.all([
  mountChrome({ requireAuth: false }),
  // Même repli que nav.js : sans configuration, on ne promet rien.
  api.config().catch(() => null),
]).then(([user, cfg]) => {
  const quota = readQuota(cfg);
  applyQuota(quota);
  applyCta(ctaState(user, cfg, quota));
});

// --- Aperçu des tarifs ---------------------------------------------------------
// Chiffres lus sur GET /api/billing/plans (source : backend/src/billing/plans.js)
// et formatés par Intl (9,90 € / €9.90 / € 9,90). 404 = facturation désactivée :
// la section reste masquée, comme la question sur la résiliation.
const pricing = document.getElementById('tarifs');

const planLabel = (p) => (has(`plans.${p.key}.label`) ? t(`plans.${p.key}.label`) : p.label || p.key);
const planPitch = (p) => (has(`plans.${p.key}.pitch`) ? t(`plans.${p.key}.pitch`) : p.pitch || '');
// Montant entier sans décimales (« 59 € », « 6 € ») : c'est un résumé
// commercial ; la page Tarifs garde le montant complet.
const price = (eur) => money(eur, Number.isInteger(Number(eur)) ? 0 : undefined);

function planCard(p) {
  // Bordure épaisse de la formule mise en avant : 1 px de marge intérieure en
  // moins, pour que les contenus des quatre cartes restent alignés.
  const border = p.highlight ? 'border-2 border-primary-container p-[23px]' : 'border border-outline-variant p-lg';
  const amount = p.eur > 0
    ? `<span class="font-display-lg text-display-lg text-on-surface">${escapeHtml(price(p.eur))}</span>
       <span class="font-body-sm text-body-sm text-secondary">${escapeHtml(t('home.pricing.perMonth'))}</span>`
    : `<span class="font-display-lg text-display-lg text-on-surface">${escapeHtml(t('home.pricing.free'))}</span>`;
  const quota = p.lifetime
    ? t('home.pricing.quotaLifetime', { count: p.quota })
    : t('home.pricing.quotaMonthly', { count: p.quota });
  return `
    <article class="bg-surface-container-lowest ${border} rounded-xl flex flex-col gap-sm">
      <h3 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(planLabel(p))}</h3>
      <p class="flex items-baseline gap-xs">${amount}</p>
      <p class="font-label-md text-label-md text-on-surface-variant">${escapeHtml(quota)}</p>
      <p class="font-body-sm text-body-sm text-secondary">${escapeHtml(planPitch(p))}</p>
    </article>`;
}

function renderPricing(data) {
  const plans = ((data && data.plans) || []).slice(0, 4);
  const paid = plans.filter((p) => Number(p.eur) > 0);
  if (!pricing || !paid.length) return;
  const from = Math.min(...paid.map((p) => Number(p.eur)));
  document.getElementById('tarifs-titre').textContent = t('home.pricing.title', { price: price(from) });
  document.getElementById('home-plans').innerHTML = plans.map(planCard).join('');
  const pack = data.pack;
  const packEl = document.getElementById('home-pack');
  if (pack && pack.credits > 0 && pack.eur > 0) {
    packEl.textContent = t('home.pricing.pack', { count: pack.credits, amount: price(pack.eur) });
    show(packEl, true);
  }
  show(pricing, true);
}

// Deux arguments à then() plutôt qu'un catch() : seul l'échec de la requête
// masque les éléments liés à la facturation ; une erreur de rendu reste visible
// en console au lieu d'être avalée.
api.billing.plans().then(renderPricing, () => {
  document.querySelectorAll('[data-needs="billing"]').forEach((el) => show(el, false));
});
