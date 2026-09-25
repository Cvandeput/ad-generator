// Chrome commun à toutes les pages : barre de navigation (état connecté /
// anonyme, menu mobile, sélecteur de langue), pied de page, bandeau cookies,
// modale de ré-acceptation des mentions légales. Un seul endroit à retoucher.
//
//   <header id="site-header" data-page="home|studio|history|legal"></header>
//   <footer id="site-footer"></footer>
//   import { mountChrome } from './nav.js'; const user = await mountChrome();
import { api } from './api.js';
import { escapeHtml, usageLabel } from './components.js';
import { t, renderLanguageSwitch, wireLanguageSwitch } from './i18n.js';

// La barre desktop n'apparaît qu'à partir de `lg` (1024). En dessous — donc
// tablette portrait comprise (768/820) — c'est le menu déroulant : à `md` les
// 5 à 7 liens + le compteur de conso + le bouton « Générer » se chevauchaient.
// Cibles tactiles : 44 px minimum tant qu'on est en mode tactile (< lg).
const LINK = 'font-label-md text-label-md px-md py-sm rounded transition-colors flex items-center min-h-[44px]';
const LINK_OFF = `${LINK} text-secondary hover:text-on-surface`;
const LINK_ON = `${LINK} text-on-surface shadow-[inset_0_-2px_0_#1d4ed8]`;
const LINK_VERTICAL = '';
const BTN_PRIMARY = 'h-11 lg:h-8 px-md rounded bg-primary-container text-on-primary flex items-center justify-center gap-xs font-label-md text-label-md hover:bg-primary transition-colors';
const BTN_GHOST = 'h-11 lg:h-8 px-md rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant flex items-center justify-center gap-xs font-label-md text-label-md hover:bg-surface-container transition-colors';

// La facturation est optionnelle côté serveur : on ne montre « Tarifs » que si
// l'API répond. Résultat mis en cache pour l'onglet (une requête par session).
const BILLING_KEY = 'app.billing.v1';
async function billingAvailable() {
  try {
    const cached = sessionStorage.getItem(BILLING_KEY);
    if (cached !== null) return cached === '1';
  } catch { /* stockage indisponible */ }
  let ok = false;
  try {
    await api.billing.plans();
    ok = true;
  } catch { ok = false; }
  try { sessionStorage.setItem(BILLING_KEY, ok ? '1' : '0'); } catch { /* ignore */ }
  return ok;
}

function navLinks(page, user, billing = false) {
  const links = [{ href: '/', key: 'home', label: t('nav.home') }];
  if (page === 'home') {
    links.push({ href: '/#fonctionnement', key: 'fonctionnement', label: t('nav.howItWorks') });
    links.push({ href: '/#galerie', key: 'galerie', label: t('nav.examples') });
  }
  if (user) {
    links.push({ href: '/app.html', key: 'studio', label: t('nav.studio') });
    links.push({ href: '/history.html', key: 'history', label: t('nav.history') });
  }
  if (billing) links.push({ href: '/tarifs.html', key: 'tarifs', label: t('nav.pricing') });
  // Le lien n'apparaît que pour un admin ; la protection reste serveur (404).
  if (user && user.isAdmin) links.push({ href: '/admin.html', key: 'admin', label: t('nav.admin') });
  return links;
}

function renderLinks(page, user, vertical = false, billing = false) {
  return navLinks(page, user, billing)
    .map(
      (l) =>
        `<a href="${l.href}" ${l.key === page ? 'aria-current="page"' : ''} class="${l.key === page ? LINK_ON : LINK_OFF}${vertical ? LINK_VERTICAL : ''}">${escapeHtml(l.label)}</a>`
    )
    .join('');
}

function renderActions(page, user, cfg, vertical = false) {
  const wrap = vertical ? 'flex flex-col gap-sm pt-sm border-t border-outline-variant' : 'flex items-center gap-md';
  if (user) {
    return `
      <div class="${wrap}">
        <span id="usage-header" class="font-label-sm text-label-sm text-secondary ${vertical ? '' : 'hidden xl:block'}">—</span>
        ${page !== 'studio' ? `<a href="/app.html" class="${BTN_PRIMARY}"><span class="material-symbols-outlined text-[16px]">auto_awesome</span><span>${escapeHtml(t('nav.generate'))}</span></a>` : ''}
        <button type="button" data-action="logout" title="${escapeHtml(t('nav.logoutTitle', { email: user.email }))}" aria-label="${escapeHtml(t('nav.logout'))}"
          class="${vertical ? BTN_GHOST : 'w-11 h-11 -mr-sm flex items-center justify-center group'}">
          ${vertical ? '' : '<span class="w-7 h-7 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center text-on-surface-variant group-hover:bg-surface-container-high transition-colors">'}
          <span class="material-symbols-outlined text-[16px]">logout</span>${vertical ? `<span>${escapeHtml(t('nav.logout'))}</span>` : '</span>'}
        </button>
      </div>`;
  }
  const canRegister = cfg && cfg.registerMode && cfg.registerMode !== 'closed';
  return `
    <div class="${wrap}">
      ${canRegister ? `<a href="/register.html" class="${BTN_GHOST}">${escapeHtml(t('nav.signup'))}</a>` : ''}
      <a href="/login.html" class="${BTN_PRIMARY}">${escapeHtml(t('nav.login'))}</a>
    </div>`;
}

export function renderHeader(page, user, cfg, billing = false) {
  return `
    <div class="w-full max-w-container-max mx-auto px-lg h-[60px] flex items-center justify-between gap-md">
      <div class="flex items-center gap-lg min-w-0">
        <a href="/" class="flex items-center gap-sm shrink-0 min-h-[44px]" aria-label="${escapeHtml(t('nav.homeAria'))}">
          <img src="/img/logo-adcraft.webp" alt="${escapeHtml(t('nav.logoAlt'))}" width="105" height="24" class="h-6 w-auto" />
        </a>
        <nav class="hidden lg:flex items-center gap-xs" aria-label="${escapeHtml(t('nav.mainNav'))}">${renderLinks(page, user, false, billing)}</nav>
      </div>
      <div class="hidden lg:flex items-center gap-md">${renderLanguageSwitch({ id: 'lang-desktop' })}${renderActions(page, user, cfg)}</div>
      <button type="button" data-action="menu" class="lg:hidden w-11 h-11 -mr-sm rounded border border-outline-variant flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors"
        aria-label="${escapeHtml(t('nav.menu'))}" aria-expanded="false" aria-controls="mobile-menu">
        <span class="material-symbols-outlined text-[20px]">menu</span>
      </button>
    </div>
    <div id="mobile-menu" hidden class="lg:hidden border-t border-outline-variant bg-surface-container-lowest">
      <div class="px-lg py-md flex flex-col gap-xs">
        <nav class="flex flex-col" aria-label="${escapeHtml(t('nav.mobileNav'))}">${renderLinks(page, user, true, billing)}</nav>
        ${renderActions(page, user, cfg, true)}
        <div class="flex flex-col gap-xs pt-sm border-t border-outline-variant">
          <span class="font-label-sm text-label-sm text-secondary">${escapeHtml(t('nav.language'))}</span>
          ${renderLanguageSwitch({ id: 'lang-mobile', full: true })}
        </div>
      </div>
    </div>`;
}

// Liens de pied de page : 44 px de haut tant qu'on est en tactile (< lg), taille
// naturelle au-delà — sinon la rangée de liens fait 14 px de haut au doigt.
const FOOT_LINK =
  'font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center justify-center min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0';

export function renderFooter() {
  return `
    <div class="w-full max-w-container-max mx-auto px-lg py-lg flex flex-col md:flex-row justify-between items-center gap-md">
      <span class="font-label-sm text-label-sm text-outline">${escapeHtml(t('footer.copyright', { year: new Date().getFullYear() }))}</span>
      <nav class="flex flex-wrap justify-center gap-lg" aria-label="${escapeHtml(t('footer.legalLinks'))}">
        <a class="${FOOT_LINK}" href="/legal.html#mentions">${escapeHtml(t('footer.legalNotice'))}</a>
        <a class="${FOOT_LINK}" href="/legal.html#confidentialite">${escapeHtml(t('footer.privacy'))}</a>
        <a class="${FOOT_LINK}" href="/legal.html#cookies">${escapeHtml(t('footer.cookies'))}</a>
        <a class="${FOOT_LINK}" href="/legal.html#cgu">${escapeHtml(t('footer.terms'))}</a>
        <a class="${FOOT_LINK}" href="/legal.html#contact">${escapeHtml(t('footer.contact'))}</a>
      </nav>
    </div>`;
}

// --- Bandeau cookies : uniquement des cookies techniques (session), donc pas
// de consentement à recueillir — un bandeau d'information, mémorisé localement.
const COOKIE_KEY = 'app.cookieNotice.v1';
function cookieBanner() {
  try {
    if (localStorage.getItem(COOKIE_KEY)) return;
  } catch {
    /* stockage indisponible : on affiche à chaque fois */
  }
  const el = document.createElement('div');
  el.id = 'cookie-banner';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', t('cookies.region'));
  el.className = 'fixed bottom-md left-md right-md md:left-auto md:right-lg md:max-w-[420px] z-[60] bg-surface-container-lowest border border-outline-variant rounded-lg shadow-[0_12px_32px_rgba(26,28,28,0.14)] p-md flex flex-col gap-sm';
  el.innerHTML = `
    <div class="flex items-start gap-sm">
      <span class="material-symbols-outlined text-outline text-[20px]">cookie</span>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${t('cookies.text_html')}</p>
    </div>
    <div class="flex justify-end">
      <button type="button" data-action="cookie-ok" class="${BTN_PRIMARY}">${escapeHtml(t('cookies.ok'))}</button>
    </div>`;
  el.querySelector('[data-action="cookie-ok"]').addEventListener('click', () => {
    try {
      localStorage.setItem(COOKIE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    el.remove();
  });
  document.body.appendChild(el);
}

// --- Bandeau « adresse non confirmée » -------------------------------------
// Non bloquant (contrairement à la modale CGU) : l'utilisateur peut visiter le
// site, mais la génération lui sera refusée tant qu'il n'a pas confirmé.
function verifyBanner(user) {
  if (!user || user.emailVerified !== false) return;
  const el = document.createElement('div');
  el.id = 'verify-banner';
  el.className = 'bg-error-container border-b border-outline-variant';
  el.innerHTML = `
    <div class="w-full max-w-container-max mx-auto px-lg py-sm flex flex-wrap items-center gap-sm">
      <span class="material-symbols-outlined text-[18px] text-on-error-container">mark_email_unread</span>
      <span class="font-body-sm text-body-sm text-on-error-container flex-grow">
        ${t('verifyBanner.text_html', { email: escapeHtml(user.email) })}
      </span>
      <button type="button" data-action="resend" class="h-11 lg:h-8 px-md rounded border border-on-error-container bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md hover:bg-surface-container transition-colors">
        ${escapeHtml(t('verifyBanner.resend'))}
      </button>
    </div>`;
  el.querySelector('[data-action="resend"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('common.sending');
    try {
      await api.resendVerification();
      btn.textContent = t('verifyBanner.sent');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = t('verifyBanner.resend');
      alert(err.message || t('verifyBanner.failed'));
    }
  });
  const header = document.getElementById('site-header');
  header ? header.insertAdjacentElement('afterend', el) : document.body.prepend(el);
}

// --- Modale de (ré)acceptation des mentions légales / CGU -------------------
function termsModal(user) {
  if (!user || !user.termsOutdated) return;
  const el = document.createElement('div');
  el.id = 'terms-modal';
  el.className = 'fixed inset-0 z-[70] bg-[rgba(26,28,28,0.55)] flex items-center justify-center p-lg';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'terms-title');
  el.innerHTML = `
    <div class="w-full max-w-[460px] bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col gap-md">
      <h2 id="terms-title" class="font-headline-md text-headline-md text-on-surface">${escapeHtml(t('terms.title'))}</h2>
      <p class="font-body-base text-body-base text-on-surface-variant">${t('terms.intro_html')}</p>
      <label class="flex items-start gap-sm cursor-pointer py-sm min-h-[44px]">
        <input type="checkbox" id="terms-check" class="mt-[2px] w-5 h-5 rounded border-outline text-primary-container focus:ring-primary-container" />
        <span class="font-body-sm text-body-sm text-on-surface">${escapeHtml(t('terms.accept'))}</span>
      </label>
      <p id="terms-error" class="font-body-sm text-body-sm text-error hidden"></p>
      <div class="flex justify-end gap-sm">
        <button type="button" data-action="terms-logout" class="${BTN_GHOST}">${escapeHtml(t('terms.logoutBtn'))}</button>
        <button type="button" data-action="terms-accept" class="${BTN_PRIMARY}" disabled>${escapeHtml(t('terms.acceptBtn'))}</button>
      </div>
    </div>`;
  const check = el.querySelector('#terms-check');
  const accept = el.querySelector('[data-action="terms-accept"]');
  const error = el.querySelector('#terms-error');
  check.addEventListener('change', () => (accept.disabled = !check.checked));
  accept.addEventListener('click', async () => {
    accept.disabled = true;
    try {
      await api.acceptTerms();
      el.remove();
    } catch (err) {
      error.textContent = err.message || t('terms.error');
      error.classList.remove('hidden');
      accept.disabled = false;
    }
  });
  el.querySelector('[data-action="terms-logout"]').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    location.href = '/login.html';
  });
  document.body.appendChild(el);
}

// Monte header + footer + bandeau + modale. Retourne l'utilisateur (ou null).
//   { requireAuth: true } → 401 redirige vers /login.html (pages privées).
export async function mountChrome({ requireAuth = false } = {}) {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  const page = header?.dataset.page || 'home';

  let user = null;
  let cfg = null;
  try {
    const me = await api.me({ silent: !requireAuth });
    user = me.user;
    cfg = { registerMode: me.registerMode };
  } catch {
    user = null;
  }
  if (!user && !requireAuth) {
    cfg = await api.config().catch(() => ({ registerMode: 'closed' }));
  }
  if (!user && requireAuth) return null; // redirection déjà déclenchée

  const billing = await billingAvailable();

  if (header) {
    header.innerHTML = renderHeader(page, user, cfg, billing);
    wireLanguageSwitch(header);
    header.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'logout') {
        await api.logout().catch(() => {});
        location.href = '/login.html';
      }
      if (btn.dataset.action === 'menu') {
        const menu = header.querySelector('#mobile-menu');
        const open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        btn.querySelector('.material-symbols-outlined').textContent = open ? 'close' : 'menu';
      }
    });
    if (user) {
      api
        .usage()
        .then((u) => header.querySelectorAll('#usage-header').forEach((el) => (el.textContent = usageLabel(u))))
        .catch(() => {});
    }
  }
  if (footer) footer.innerHTML = renderFooter();

  cookieBanner();
  termsModal(user);
  verifyBanner(user);
  return user;
}

// Rafraîchit le compteur de consommation du header (après une génération).
export async function refreshUsage() {
  try {
    const u = await api.usage();
    document.querySelectorAll('#usage-header').forEach((el) => (el.textContent = usageLabel(u)));
    return u;
  } catch {
    return null;
  }
}
