// Page tarifs (prototype facturation). Fonctionne aussi quand la facturation
// est désactivée côté serveur : la page l'annonce au lieu de planter.
import { api, ApiError } from './api.js';
import { escapeHtml } from './components.js';
import { mountChrome } from './nav.js';

const plansEl = document.getElementById('plans');
const currentEl = document.getElementById('current');
const packEl = document.getElementById('pack');
const bannerEl = document.getElementById('mode-banner');

const BTN = 'h-9 px-lg rounded font-label-md text-label-md flex items-center justify-center gap-xs transition-colors';
const BTN_PRIMARY = `${BTN} bg-primary-container text-on-primary hover:bg-primary disabled:opacity-60`;
const BTN_GHOST = `${BTN} border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container disabled:opacity-60`;

const eur = (n) => (Number(n) === 0 ? 'Gratuit' : `${Number(n).toFixed(2).replace('.', ',')} €`);
const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' }) : '');

// « Bienvenue » : on arrive de l'inscription, le compte est sur la formule
// gratuite et on invite à choisir un abonnement (sans l'imposer).
const ONBOARDING = new URLSearchParams(location.search).get('bienvenue') === '1';

let state = { mode: 'demo', plans: [], pack: null, sub: null, user: null };

function notice(kind, text) {
  const tone = kind === 'ok'
    ? 'bg-surface-container-low border-outline-variant text-on-surface-variant'
    : 'bg-error-container border-error text-on-error-container';
  return `<div class="border rounded-lg px-md py-sm font-body-sm text-body-sm ${tone}">${text}</div>`;
}

function planCard(p) {
  const cur = state.sub && state.sub.planKey === p.key && state.sub.status !== 'inactive';
  const isFree = p.key === 'free';
  const border = p.highlight ? 'border-2 border-primary-container' : 'border border-outline-variant';
  const quota = p.lifetime ? `${p.quota} générations au total` : `${p.quota} générations / mois`;
  const unit = p.eur > 0 ? `soit ${(p.eur / p.quota).toFixed(2).replace('.', ',')} € par visuel` : 'sans carte bancaire';

  let action;
  if (!state.user) {
    action = `<a href="/register.html" class="${p.highlight ? BTN_PRIMARY : BTN_GHOST} w-full">${isFree ? 'Créer un compte' : 'Choisir'}</a>`;
  } else if (isFree) {
    // En onboarding, le plan gratuit est une vraie sortie : « continuer sans payer ».
    action = ONBOARDING
      ? `<a href="/app.html" class="${BTN_GHOST} w-full">Continuer en gratuit</a>`
      : `<button type="button" class="${BTN_GHOST} w-full" disabled>${cur ? 'Formule actuelle' : 'Inclus par défaut'}</button>`;
  } else if (cur) {
    action = `<button type="button" class="${BTN_GHOST} w-full" disabled>Formule actuelle</button>`;
  } else {
    action = `<button type="button" data-plan="${p.key}" class="js-subscribe ${p.highlight ? BTN_PRIMARY : BTN_GHOST} w-full">${state.sub && state.sub.planKey !== 'free' ? 'Changer pour cette formule' : 'Choisir'}</button>`;
  }

  return `
    <article class="relative bg-surface-container-lowest ${border} rounded-xl p-lg flex flex-col gap-md">
      ${p.highlight ? '<span class="absolute -top-[11px] left-lg bg-primary-container text-on-primary font-label-sm text-label-sm px-sm py-[3px] rounded-full">Recommandé</span>' : ''}
      <div class="flex flex-col gap-xs">
        <h2 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(p.label)}</h2>
        <p class="font-body-sm text-body-sm text-secondary min-h-[36px]">${escapeHtml(p.pitch)}</p>
      </div>
      <div class="flex flex-col gap-[2px]">
        <span class="font-display-lg text-display-lg text-on-surface">${eur(p.eur)}${p.eur > 0 ? '<span class="font-body-sm text-body-sm text-secondary"> /mois</span>' : ''}</span>
        <span class="font-label-sm text-label-sm text-outline">${unit}</span>
      </div>
      <div class="h-px bg-outline-variant"></div>
      <ul class="flex flex-col gap-xs flex-grow">
        <li class="flex items-start gap-xs font-body-sm text-body-sm text-on-surface">
          <span class="material-symbols-outlined text-[16px] text-primary-container mt-[1px]">check</span><strong>${quota}</strong>
        </li>
        ${p.features.slice(1).map((f) => `
          <li class="flex items-start gap-xs font-body-sm text-body-sm text-on-surface-variant">
            <span class="material-symbols-outlined text-[16px] text-outline mt-[1px]">check</span>${escapeHtml(f)}
          </li>`).join('')}
      </ul>
      ${action}
    </article>`;
}

function renderPlans() {
  plansEl.innerHTML = state.plans.map(planCard).join('');
}

function renderCurrent() {
  const s = state.sub;
  // À l'inscription, afficher « 0 / 5 utilisées » n'apporte rien : on laisse la
  // place au choix de formule.
  if (!s || (ONBOARDING && s.planKey === 'free')) { currentEl.classList.add('hidden'); return; }
  // Compte admin : quota illimité (le serveur renvoie quota = null, Infinity
  // n'étant pas représentable en JSON).
  const pct = s.unlimited ? 0 : s.quota > 0 ? Math.min(100, Math.round((s.used / s.quota) * 100)) : 100;
  const paid = s.planKey !== 'free' && s.status !== 'inactive';
  currentEl.classList.remove('hidden');
  currentEl.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col md:flex-row md:items-center gap-lg">
      <div class="flex flex-col gap-xs flex-grow min-w-0">
        <span class="font-label-sm text-label-sm font-semibold tracking-[0.08em] uppercase text-secondary">Votre formule</span>
        <span class="font-headline-md text-headline-md text-on-surface">${escapeHtml(s.planLabel)}${s.status === 'past_due' ? ' <span class="font-body-sm text-error">(paiement en attente)</span>' : ''}</span>
        <span class="font-body-sm text-body-sm text-secondary">
          ${s.unlimited ? `${s.used} générations · aucune limite` : `${s.used} / ${s.quota} générations utilisées`}${s.credits ? ` · ${s.credits} crédit${s.credits > 1 ? 's' : ''} en réserve` : ''}
          ${s.lifetime ? '' : s.periodEnd ? ` · recharge le ${fmtDate(s.periodEnd)}` : ''}
          ${s.cancelAtPeriodEnd ? ' · résiliation programmée' : ''}
        </span>
        <div class="progress-track mt-xs max-w-[420px]"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div>
      <div class="flex gap-sm flex-shrink-0 flex-wrap">
        <a href="/app.html" class="${BTN_GHOST}">Ouvrir le studio</a>
        ${paid ? `<button type="button" class="js-portal ${BTN_PRIMARY}">Gérer mon abonnement</button>` : ''}
        ${paid && state.mode === 'demo' ? `<button type="button" class="js-cancel ${BTN_GHOST}">Résilier (démo)</button>` : ''}
      </div>
    </div>`;
}

function renderPack() {
  if (!state.user || !state.pack) { packEl.classList.add('hidden'); return; }
  packEl.classList.remove('hidden');
  packEl.innerHTML = `
    <div class="bg-surface-container-low border border-outline-variant rounded-xl p-lg flex flex-col md:flex-row md:items-center justify-between gap-md">
      <div class="flex flex-col gap-xs">
        <span class="font-label-md text-label-md text-on-surface">Besoin de plus ce mois-ci ?</span>
        <span class="font-body-sm text-body-sm text-secondary">Pack de ${state.pack.credits} générations à ${eur(state.pack.eur)}, sans abonnement. Les crédits n'expirent pas et se consomment une fois le quota mensuel épuisé.</span>
      </div>
      <button type="button" class="js-pack ${BTN_GHOST} flex-shrink-0">Acheter le pack</button>
    </div>`;
}

async function go(promise, btn) {
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Redirection…'; }
  try {
    const { url, demo } = await promise;
    if (url) { window.location.href = url; return; }
    if (demo) window.location.reload();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = old; }
    bannerEl.innerHTML = notice('err', escapeHtml(err instanceof ApiError ? err.message : 'Opération impossible'));
    bannerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

document.addEventListener('click', (e) => {
  const sub = e.target.closest('.js-subscribe');
  if (sub) return go(api.billing.checkout(sub.dataset.plan), sub);
  const portal = e.target.closest('.js-portal');
  if (portal) return go(api.billing.portal(), portal);
  const pack = e.target.closest('.js-pack');
  if (pack) return go(api.billing.pack(), pack);
  const cancel = e.target.closest('.js-cancel');
  if (cancel && confirm('Résilier tout de suite (mode démo) ?')) return go(api.billing.cancel(), cancel);
});

// Messages de retour (Checkout / démo). Le webhook fait foi : on ne provisionne
// rien ici, on affiche seulement.
function feedback() {
  const q = new URLSearchParams(location.search);
  if (q.get('checkout') === 'success') return notice('ok', 'Paiement enregistré. Votre formule est active — si le compteur ci-dessous n\'est pas encore à jour, rafraîchissez dans quelques secondes.');
  if (q.get('checkout') === 'cancel') return notice('ok', 'Paiement annulé, aucun montant n\'a été débité.');
  if (q.get('pack') === 'success') return notice('ok', 'Pack de générations crédité.');
  if (q.get('demo') === 'souscrit') return notice('ok', 'Formule activée en <strong>mode démo</strong> : rien n\'a été facturé, aucun appel à Stripe.');
  if (q.get('verif') === '1') return notice('ok', "Votre compte est créé. <strong>Un e-mail de confirmation vient de partir</strong> : cliquez sur le lien pour débloquer vos générations offertes. Vous pouvez déjà choisir un abonnement — il est actif immédiatement, sans attendre la confirmation.");
  if (q.get('bienvenue') === '1') return notice('ok', 'Votre compte est créé. Vous pouvez commencer gratuitement ou prendre un abonnement tout de suite — le paiement se fait sur une page sécurisée Stripe.');
  if (q.get('demo') === 'pack') return notice('ok', 'Crédits ajoutés en <strong>mode démo</strong>.');
  return '';
}

function renderHeading() {
  if (!ONBOARDING) return;
  const t = document.getElementById('page-title');
  const sub = document.getElementById('page-sub');
  if (t) t.textContent = 'Bienvenue — choisissez votre formule';
  if (sub) {
    const free = state.plans.find((p) => p.key === 'free');
    sub.textContent = free
      ? `Votre compte démarre avec ${free.quota} générations offertes. Prenez un abonnement quand vous voulez aller plus loin : paiement sécurisé par Stripe, résiliable en un clic.`
      : 'Choisissez la formule qui correspond à votre volume. Paiement sécurisé par Stripe, résiliable en un clic.';
  }
}

(async () => {
  state.user = await mountChrome({ requireAuth: false });

  let cfg;
  try {
    cfg = await api.billing.plans();
  } catch (err) {
    plansEl.innerHTML = notice('err', err instanceof ApiError && err.status === 404
      ? 'La facturation n\'est pas activée sur ce serveur (<code>BILLING_ENABLED=false</code>).'
      : 'Impossible de charger les formules.');
    return;
  }
  state.mode = cfg.mode;
  state.plans = cfg.plans;
  state.pack = cfg.pack;

  if (state.user) {
    try { state.sub = await api.billing.subscription(); } catch { /* ignoré */ }
  }

  bannerEl.innerHTML = (state.mode === 'demo'
    ? notice('ok', '<strong>Prototype — mode démo.</strong> Aucune clé Stripe configurée : les boutons simulent l\'abonnement en base pour tester les quotas. Aucun paiement, aucune carte.')
    : '') + feedback();

  renderHeading();
  renderCurrent();
  renderPlans();
  renderPack();
})();
