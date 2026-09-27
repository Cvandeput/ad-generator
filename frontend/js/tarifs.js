// Page tarifs (prototype facturation). Fonctionne aussi quand la facturation
// est désactivée côté serveur : la page l'annonce au lieu de planter.
//
// i18n : les formules arrivent du backend en français (label, pitch, features).
// On les retraduit côté client via la clé de formule (`free`, `starter`, `pro`,
// `studio`), stable et indépendante de la langue ; si une clé inconnue
// apparaît, on retombe sur le texte envoyé par le serveur.
import { api, ApiError } from './api.js';
import { escapeHtml } from './components.js';
import { mountChrome } from './nav.js';
import { openModal, BTN_DANGER } from './modal.js';
import { t, tList, has, money, date } from './i18n.js';

// Montants : le serveur ne parle qu'en CENTIMES ENTIERS, l'affichage passe par
// Intl (9,96 € en fr-BE, €9.96 en en-GB, € 9,96 en nl-BE). Aucune arithmétique
// monétaire côté front — on divise par 100 au dernier moment, pour afficher.
const eurCents = (cents) => money((Number(cents) || 0) / 100);

const plansEl = document.getElementById('plans');
const currentEl = document.getElementById('current');
const packEl = document.getElementById('pack');
const bannerEl = document.getElementById('mode-banner');
const withdrawalEl = document.getElementById('withdrawal');
const accountEl = document.getElementById('account');

const BTN = 'min-h-[44px] lg:min-h-0 lg:h-9 py-xs px-lg rounded font-label-md text-label-md text-center leading-tight flex items-center justify-center gap-xs transition-colors';
const BTN_PRIMARY = `${BTN} bg-primary-container text-on-primary hover:bg-primary disabled:opacity-60`;
const BTN_GHOST = `${BTN} border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container disabled:opacity-60`;

// Montants et dates : Intl uniquement. 9,90 € (fr-BE) / €9.90 (en-GB) / € 9,90 (nl-BE).
const eur = (n) => (Number(n) === 0 ? t('pricing.free') : money(n));
const fmtDate = (s) => date(s, { day: '2-digit', month: 'long', year: 'numeric' });
// Échéance de rétractation : le serveur la fixe à 23:59:59 UTC du dernier jour
// (backend/src/billing/withdrawal.js, deadlineFrom). Formatée en heure locale,
// elle glisserait au lendemain à Bruxelles (01:59) et annoncerait un jour que
// le serveur refuse déjà : on l'affiche donc dans le fuseau où elle est calculée.
const fmtDeadline = (s) => date(s, { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

const planLabel = (key, fallback) => (has(`plans.${key}.label`) ? t(`plans.${key}.label`) : fallback || key);
const planPitch = (p) => (has(`plans.${p.key}.pitch`) ? t(`plans.${p.key}.pitch`) : p.pitch || '');
// Le premier « feature » renvoyé par le serveur est la ligne de quota, que la
// carte recompose elle-même : on ne traduit que la suite.
function planFeatures(p) {
  const fromDict = tList(`plans.${p.key}.features`);
  return fromDict.length ? fromDict : (p.features || []).slice(1);
}

// « Bienvenue » : on arrive de l'inscription, le compte est sur la formule
// gratuite et on invite à choisir un abonnement (sans l'imposer).
const ONBOARDING = new URLSearchParams(location.search).get('bienvenue') === '1';

let state = { mode: 'demo', plans: [], pack: null, sub: null, user: null, withdrawal: null };

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
  const quota = p.lifetime
    ? t('pricing.quotaLifetime', { count: p.quota })
    : t('pricing.quotaMonthly', { count: p.quota });
  const unit = p.eur > 0
    ? t('pricing.unitPrice', { amount: money(p.eur / p.quota) })
    : t('pricing.noCard');

  let action;
  if (!state.user) {
    action = `<a href="/register.html" class="${p.highlight ? BTN_PRIMARY : BTN_GHOST} w-full">${escapeHtml(isFree ? t('pricing.cta.createAccount') : t('pricing.cta.choose'))}</a>`;
  } else if (isFree) {
    // En onboarding, le plan gratuit est une vraie sortie : « continuer sans payer ».
    action = ONBOARDING
      ? `<a href="/app.html" class="${BTN_GHOST} w-full">${escapeHtml(t('pricing.cta.continueFree'))}</a>`
      : `<button type="button" class="${BTN_GHOST} w-full" disabled>${escapeHtml(cur ? t('pricing.cta.currentPlan') : t('pricing.cta.includedByDefault'))}</button>`;
  } else if (cur) {
    action = `<button type="button" class="${BTN_GHOST} w-full" disabled>${escapeHtml(t('pricing.cta.currentPlan'))}</button>`;
  } else {
    const label = state.sub && state.sub.planKey !== 'free' ? t('pricing.cta.switchPlan') : t('pricing.cta.choose');
    action = `<button type="button" data-plan="${p.key}" class="js-subscribe ${p.highlight ? BTN_PRIMARY : BTN_GHOST} w-full">${escapeHtml(label)}</button>`;
  }

  return `
    <article class="relative bg-surface-container-lowest ${border} rounded-xl p-lg flex flex-col gap-md">
      ${p.highlight ? `<span class="absolute -top-[11px] left-lg bg-primary-container text-on-primary font-label-sm text-label-sm px-sm py-[3px] rounded-full">${escapeHtml(t('pricing.recommended'))}</span>` : ''}
      <div class="flex flex-col gap-xs">
        <h2 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(planLabel(p.key, p.label))}</h2>
        <p class="font-body-sm text-body-sm text-secondary min-h-[36px]">${escapeHtml(planPitch(p))}</p>
      </div>
      <div class="flex flex-col gap-[2px]">
        <span class="font-display-lg text-display-lg text-on-surface">${escapeHtml(eur(p.eur))}${p.eur > 0 ? `<span class="font-body-sm text-body-sm text-secondary"> ${escapeHtml(t('pricing.perMonth'))}</span>` : ''}</span>
        <span class="font-label-sm text-label-sm text-outline">${escapeHtml(unit)}</span>
      </div>
      <div class="h-px bg-outline-variant"></div>
      <ul class="flex flex-col gap-xs flex-grow">
        <li class="flex items-start gap-xs font-body-sm text-body-sm text-on-surface">
          <span class="material-symbols-outlined text-[16px] text-primary-container mt-[1px]">check</span><strong>${escapeHtml(quota)}</strong>
        </li>
        ${planFeatures(p).map((f) => `
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
        <span class="font-label-sm text-label-sm font-semibold tracking-[0.08em] uppercase text-secondary">${escapeHtml(t('pricing.current.label'))}</span>
        <span class="font-headline-md text-headline-md text-on-surface">${escapeHtml(planLabel(s.planKey, s.planLabel))}${s.status === 'past_due' ? ` ${t('pricing.current.pastDue_html')}` : ''}</span>
        <span class="font-body-sm text-body-sm text-secondary">
          ${escapeHtml(s.unlimited
            ? t('pricing.current.unlimited', { used: s.used })
            : t('pricing.current.used', { used: s.used, quota: s.quota }))}${s.credits ? escapeHtml(t('pricing.current.credits', { count: s.credits })) : ''}
          ${s.lifetime ? '' : s.periodEnd ? escapeHtml(t('pricing.current.renew', { date: fmtDate(s.periodEnd) })) : ''}
          ${s.cancelAtPeriodEnd ? escapeHtml(t('pricing.current.cancelScheduled')) : ''}
        </span>
        <div class="progress-track mt-xs max-w-[420px]"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div>
      <div class="flex gap-sm flex-shrink-0 flex-wrap">
        <a href="/app.html" class="${BTN_GHOST}">${escapeHtml(t('pricing.current.openStudio'))}</a>
        ${paid ? `<button type="button" class="js-portal ${BTN_PRIMARY}">${escapeHtml(t('pricing.current.manage'))}</button>` : ''}
        ${paid && state.mode === 'demo' ? `<button type="button" class="js-cancel ${BTN_GHOST}">${escapeHtml(t('pricing.current.cancelDemo'))}</button>` : ''}
      </div>
    </div>`;
}

function renderPack() {
  if (!state.user || !state.pack) { packEl.classList.add('hidden'); return; }
  packEl.classList.remove('hidden');
  packEl.innerHTML = `
    <div class="bg-surface-container-low border border-outline-variant rounded-xl p-lg flex flex-col md:flex-row md:items-center justify-between gap-md">
      <div class="flex flex-col gap-xs">
        <span class="font-label-md text-label-md text-on-surface">${escapeHtml(t('pricing.pack.title'))}</span>
        <span class="font-body-sm text-body-sm text-secondary">${escapeHtml(t('pricing.pack.text', { count: state.pack.credits, amount: eur(state.pack.eur) }))}</span>
      </div>
      <button type="button" class="js-pack ${BTN_GHOST} flex-shrink-0">${escapeHtml(t('pricing.pack.buy'))}</button>
    </div>`;
}

// --- Consentement exprès à l'exécution immédiate ------------------------------
// Sans cette étape, pas de prorata possible : la rétractation donnerait droit au
// remboursement intégral. Le serveur refuse d'ailleurs le paiement sans elle.
async function askConsent({ title, intro }) {
  const res = await openModal({
    title,
    bodyHtml: `
      <p>${escapeHtml(intro)}</p>
      <p class="font-body-sm text-body-sm text-secondary">${escapeHtml(t('withdrawal.consent.explain'))}</p>`,
    checkLabel: t('withdrawal.consent.checkbox'),
    confirmLabel: t('withdrawal.consent.confirm'),
  });
  return !!res;
}

// --- Encart de rétractation ---------------------------------------------------
// Affiché UNIQUEMENT si le compte est éligible. Un encart permanent
// « rétractez-vous » sur une page de tarifs serait au mieux inutile, au pire une
// invitation ; l'obligation est d'informer, pas de démarcher.
function withdrawalCard(w, kind) {
  const isPack = kind === 'pack';
  const used = isPack ? w.credits - w.refundableCredits : w.billable;
  const total = isPack ? w.credits : w.quota;

  // La phrase qui évite les litiges : combien a été utilisé, combien revient.
  const detail = isPack
    ? t('withdrawal.pack.detail', { left: w.refundableCredits, total: w.credits, amount: eurCents(w.refundCents) })
    : t('withdrawal.sub.detail', { used, total, amount: eurCents(w.refundCents) });

  return `
    <div class="bg-surface-container-low border border-outline-variant rounded-xl p-lg flex flex-col gap-sm">
      <div class="flex items-start gap-sm">
        <span class="material-symbols-outlined text-outline text-[20px] mt-[1px]" aria-hidden="true">history</span>
        <div class="flex flex-col gap-xs flex-grow min-w-0">
          <span class="font-label-md text-label-md text-on-surface">${escapeHtml(isPack ? t('withdrawal.pack.title') : t('withdrawal.sub.title'))}</span>
          <span class="font-body-sm text-body-sm text-secondary">${escapeHtml(detail)}</span>
          <span class="font-label-sm text-label-sm text-outline">${escapeHtml(t('withdrawal.daysLeft', { count: w.daysLeft, date: fmtDeadline(w.deadline) }))}</span>
          ${w.manualReview ? `<span class="font-body-sm text-body-sm text-on-error-container bg-error-container rounded px-sm py-xs">${escapeHtml(t('withdrawal.manualReview'))}</span>` : ''}
        </div>
      </div>
      <div class="flex justify-end">
        <button type="button" class="js-withdraw ${BTN_GHOST}" data-kind="${escapeHtml(kind)}" data-amount="${w.refundCents}">${escapeHtml(t('withdrawal.cta'))}</button>
      </div>
    </div>`;
}

function renderWithdrawal() {
  const w = state.withdrawal;
  if (!w) { withdrawalEl.classList.add('hidden'); return; }
  const cards = [];
  if (w.subscription?.eligible) cards.push(withdrawalCard(w.subscription, 'subscription'));
  if (w.pack?.eligible) cards.push(withdrawalCard(w.pack, 'pack'));
  if (!cards.length) { withdrawalEl.classList.add('hidden'); return; }
  withdrawalEl.classList.remove('hidden');
  withdrawalEl.innerHTML = cards.join('');
}

async function doWithdraw(btn) {
  const kind = btn.dataset.kind;
  const w = kind === 'pack' ? state.withdrawal.pack : state.withdrawal.subscription;
  const amount = Number(btn.dataset.amount);

  const res = await openModal({
    title: t('withdrawal.confirm.title'),
    // Le montant EXACT, en gros, avant toute confirmation. C'est la ligne qui
    // évite la réclamation : personne ne découvre le chiffre après coup.
    bodyHtml: `
      <p class="font-display-lg text-display-lg text-on-surface">${escapeHtml(eurCents(amount))}</p>
      <p>${escapeHtml(kind === 'pack'
        ? t('withdrawal.pack.detail', { left: w.refundableCredits, total: w.credits, amount: eurCents(amount) })
        : t('withdrawal.sub.detail', { used: w.billable, total: w.quota, amount: eurCents(amount) }))}</p>
      <p class="font-body-sm text-body-sm text-secondary">${escapeHtml(kind === 'pack' ? t('withdrawal.confirm.packEffect') : t('withdrawal.confirm.subEffect'))}</p>`,
    checkLabel: t('withdrawal.confirm.checkbox'),
    confirmLabel: t('withdrawal.confirm.cta'),
    confirmClass: BTN_DANGER,
  });
  if (!res) return;

  btn.disabled = true;
  btn.textContent = t('common.loading');
  try {
    const out = await api.billing.withdraw(kind, amount);
    bannerEl.innerHTML = notice('ok', escapeHtml(
      out.status === 'review'
        ? t('withdrawal.notices.review', { amount: eurCents(out.refundCents) })
        : t('withdrawal.notices.done', { amount: eurCents(out.refundCents) })
    ));
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = t('withdrawal.cta');
    // AMOUNT_CHANGED : des générations ont été consommées pendant que l'écran
    // était ouvert. On recharge plutôt que de rembourser un montant périmé.
    const changed = err instanceof ApiError && err.code === 'AMOUNT_CHANGED';
    bannerEl.innerHTML = notice('err', escapeHtml(changed ? t('withdrawal.errors.amountChanged') : err.message || t('pricing.errors.operationFailed')));
    if (changed) setTimeout(() => location.reload(), 2000);
    bannerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// --- Lien vers « Mon compte » -------------------------------------------------
// La suppression du compte (et le mot de passe, la langue, les sessions) vit
// désormais sur /account.html. Ici, un simple lien discret pour qui est connecté.
function renderAccountLink() {
  if (!state.user) { accountEl.classList.add('hidden'); return; }
  accountEl.classList.remove('hidden');
  accountEl.innerHTML = `
    <p class="font-body-sm text-body-sm text-secondary text-center">
      ${escapeHtml(t('pricing.manageAccountHint'))}
      <a href="/account.html" class="inline-flex items-center gap-[2px] min-h-[44px] lg:min-h-0 text-primary-container hover:text-primary"><span class="underline underline-offset-2">${escapeHtml(t('pricing.manageAccount'))}</span><span class="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span></a>
    </p>`;
}

async function go(promise, btn) {
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = t('pricing.redirecting'); }
  try {
    const { url, demo } = await promise;
    if (url) { window.location.href = url; return; }
    if (demo) window.location.reload();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = old; }
    bannerEl.innerHTML = notice('err', escapeHtml(err instanceof ApiError ? err.message : t('pricing.errors.operationFailed')));
    bannerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

document.addEventListener('click', async (e) => {
  const sub = e.target.closest('.js-subscribe');
  if (sub) {
    // Le consentement se recueille AVANT la redirection vers Stripe, dans notre
    // interface et dans la langue du visiteur. Stripe n'a pas de champ de
    // consentement pour la renonciation à la rétractation, et son accusé
    // resterait chez lui alors que le prorata se calcule chez nous.
    const label = planLabel(sub.dataset.plan);
    if (!(await askConsent({ title: t('withdrawal.consent.title'), intro: t('withdrawal.consent.introSub', { plan: label }) }))) return;
    return go(api.billing.checkout(sub.dataset.plan, true), sub);
  }
  const portal = e.target.closest('.js-portal');
  if (portal) return go(api.billing.portal(), portal);
  const pack = e.target.closest('.js-pack');
  if (pack) {
    if (!(await askConsent({ title: t('withdrawal.consent.title'), intro: t('withdrawal.consent.introPack', { count: state.pack?.credits ?? 0 }) }))) return;
    return go(api.billing.pack(true), pack);
  }
  const cancel = e.target.closest('.js-cancel');
  if (cancel && confirm(t('pricing.current.cancelConfirm'))) return go(api.billing.cancel(), cancel);
  const withdraw = e.target.closest('.js-withdraw');
  if (withdraw) return doWithdraw(withdraw);
});

// Messages de retour (Checkout / démo). Le webhook fait foi : on ne provisionne
// rien ici, on affiche seulement.
function feedback() {
  const q = new URLSearchParams(location.search);
  if (q.get('checkout') === 'success') return notice('ok', t('pricing.notices.checkoutSuccess'));
  if (q.get('checkout') === 'cancel') return notice('ok', t('pricing.notices.checkoutCancel'));
  if (q.get('pack') === 'success') return notice('ok', t('pricing.notices.packSuccess'));
  if (q.get('demo') === 'souscrit') return notice('ok', t('pricing.notices.demoSubscribed_html'));
  if (q.get('verif') === '1') return notice('ok', t('pricing.notices.verif_html'));
  if (q.get('bienvenue') === '1') return notice('ok', t('pricing.notices.welcome'));
  if (q.get('demo') === 'pack') return notice('ok', t('pricing.notices.demoPack_html'));
  return '';
}

function renderHeading() {
  if (!ONBOARDING) return;
  const title = document.getElementById('page-title');
  const sub = document.getElementById('page-sub');
  if (title) title.textContent = t('pricing.onboardingTitle');
  if (sub) {
    const free = state.plans.find((p) => p.key === 'free');
    sub.textContent = free
      ? t('pricing.onboardingSub', { count: free.quota })
      : t('pricing.onboardingSubNoFree');
  }
}

(async () => {
  state.user = await mountChrome({ requireAuth: false });

  let cfg;
  try {
    cfg = await api.billing.plans();
  } catch (err) {
    plansEl.innerHTML = notice('err', err instanceof ApiError && err.status === 404
      ? t('pricing.errors.billingDisabled_html')
      : t('pricing.errors.plansUnavailable'));
    return;
  }
  state.mode = cfg.mode;
  state.plans = cfg.plans;
  state.pack = cfg.pack;

  if (state.user) {
    try { state.sub = await api.billing.subscription(); } catch { /* ignoré */ }
    // L'éligibilité et le montant sont calculés par le serveur : le front ne
    // refait aucun calcul monétaire, il affiche des centimes reçus.
    try { state.withdrawal = await api.billing.withdrawal(); } catch { /* ignoré */ }
  }

  bannerEl.innerHTML = (state.mode === 'demo' ? notice('ok', t('pricing.notices.demoMode_html')) : '') + feedback();

  renderHeading();
  renderCurrent();
  renderWithdrawal();
  renderPlans();
  renderPack();
  renderAccountLink();
})();
