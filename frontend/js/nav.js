// Chrome commun à toutes les pages : barre de navigation (état connecté /
// anonyme, menu compte, menu mobile, sélecteur de langue compact), pied de
// page, barre d'information cookies, modale de ré-acceptation des mentions
// légales. Un seul endroit à retoucher.
//
//   <header id="site-header" data-page="home|studio|history|tarifs|account|admin|legal"></header>
//   <footer id="site-footer"></footer>
//   import { mountChrome } from './nav.js'; const user = await mountChrome();
import { api } from './api.js';
import { escapeHtml, usageLabel } from './components.js';
import { t, LOCALES, LANGS, currentLang, setLang } from './i18n.js';

// La barre desktop n'apparaît qu'à partir de `lg` (1024). En dessous — donc
// tablette portrait comprise (768/820) — c'est le menu déroulant : à `md` les
// 5 à 7 liens + le compteur de conso + le bouton « Générer » se chevauchaient.
// Cibles tactiles : 44 px minimum tant qu'on est en mode tactile (< lg).
const LINK = 'font-label-md text-label-md px-md py-sm rounded transition-colors flex items-center min-h-[44px]';
const LINK_OFF = `${LINK} text-secondary hover:text-on-surface`;
const LINK_ON = `${LINK} text-on-surface shadow-[inset_0_-2px_0_#b8431a]`;
const LINK_VERTICAL = '';
const BTN_PRIMARY = 'h-11 lg:h-8 px-md rounded bg-primary-container text-on-primary flex items-center justify-center gap-xs font-label-md text-label-md hover:bg-primary transition-colors';
const BTN_GHOST = 'h-11 lg:h-8 px-md rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant flex items-center justify-center gap-xs font-label-md text-label-md hover:bg-surface-container transition-colors';
// Lien discret (« Se connecter » pour un visiteur) : pas de bordure, pas de fond.
const TEXT_LINK = 'min-h-[44px] lg:min-h-0 lg:h-8 px-sm rounded inline-flex items-center justify-center font-label-md text-label-md text-secondary hover:text-on-surface hover:underline underline-offset-4 transition-colors';
// Entrées du menu compte (liens et bouton de déconnexion).
const MENU_ITEM = 'w-full flex items-center gap-sm px-md min-h-[44px] lg:min-h-[36px] font-label-md text-label-md text-left text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-container';
const MENU_ITEM_ON = ' text-on-surface bg-surface-container-low';
// Sélecteur de langue compact : texte seul, 44 px de cible au doigt (< lg).
const LANG_LINK = 'min-h-[44px] min-w-[44px] lg:min-h-[28px] lg:min-w-[28px] px-[6px] rounded inline-flex items-center justify-center font-label-sm text-label-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-container';

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

// Menu principal. Pas de lien « Accueil » : le logo y mène déjà.
//   visiteur  : Fonctionnement, Exemples, Tarifs, FAQ (sections de l'accueil ;
//               sur l'accueil, « Tarifs » vise l'aperçu #tarifs)
//   connecté  : Studio, Historique, Tarifs (le reste est dans le menu compte)
function navLinks(page, user, billing = false) {
  const links = [];
  if (user) {
    links.push({ href: '/app.html', key: 'studio', label: t('nav.studio') });
    links.push({ href: '/history.html', key: 'history', label: t('nav.history') });
    if (billing) links.push({ href: '/tarifs.html', key: 'tarifs', label: t('nav.pricing') });
    return links;
  }
  // Sur l'accueil, ancre locale : « /#… » rechargerait la page quand l'URL
  // porte ?lang=.
  const home = page === 'home' ? '' : '/';
  links.push({ href: `${home}#fonctionnement`, key: 'fonctionnement', label: t('nav.howItWorks') });
  links.push({ href: `${home}#galerie`, key: 'galerie', label: t('nav.examples') });
  if (billing) links.push({ href: page === 'home' ? '#tarifs' : '/tarifs.html', key: 'tarifs', label: t('nav.pricing') });
  links.push({ href: `${home}#faq`, key: 'faq', label: t('nav.faq') });
  return links;
}

// Appel à l'action du visiteur (réponse de GET /api/auth/config) :
//   inscription ouverte ET générations offertes → « Essayer gratuitement »
//   inscription possible (invitation, ou rien d'offert) → « Créer un compte »
//   inscription fermée → rien (la connexion devient le bouton principal)
const DEFAULT_FREE_QUOTA = 5; // serveur antérieur à freeQuota
function signupLabel(cfg) {
  const mode = cfg && cfg.registerMode;
  if (!mode || mode === 'closed') return null;
  const q = Number(cfg.freeQuota);
  const free = cfg.freeQuota !== undefined && Number.isInteger(q) && q >= 0 ? q : DEFAULT_FREE_QUOTA;
  return mode === 'open' && free > 0 ? t('nav.tryFree') : t('nav.signup');
}

function renderLinks(page, user, vertical = false, billing = false) {
  return navLinks(page, user, billing)
    .map(
      (l) =>
        `<a href="${l.href}" ${l.key === page ? 'aria-current="page"' : ''} class="${l.key === page ? LINK_ON : LINK_OFF}${vertical ? LINK_VERTICAL : ''}">${escapeHtml(l.label)}</a>`
    )
    .join('');
}

// --- Sélecteur de langue compact « FR · EN · NL » ---------------------------
// Trois liens texte au lieu d'un <select> bordé. Chaque lien porte une vraie
// URL ?lang=xx (clic du milieu, JS coupé : i18n.js mémorise la langue à
// l'arrivée) ; au clic, setLang() mémorise dans localStorage, aligne l'URL et
// recharge — le comportement du <select> d'i18n.js, à l'identique.
// Nom accessible « FR (Français) » : il contient le libellé visible (WCAG 2.5.3).
function langHref(code) {
  const url = new URL(location.href);
  url.searchParams.set('lang', code);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function renderLangCompact() {
  const cur = currentLang();
  const items = LANGS.map((code) => {
    const on = code === cur;
    return `<a href="${escapeHtml(langHref(code))}" data-lang="${code}" hreflang="${LOCALES[code].html}" lang="${LOCALES[code].html}"${on ? ' aria-current="true"' : ''}
        class="${LANG_LINK} ${on ? 'text-on-surface font-semibold' : 'text-secondary hover:text-on-surface hover:bg-surface-container'}">${code.toUpperCase()}<span class="sr-only"> (${escapeHtml(LOCALES[code].label)})</span></a>`;
  }).join('<span class="text-outline-variant select-none" aria-hidden="true">·</span>');
  return `<div class="js-lang-compact flex items-center" role="group" aria-label="${escapeHtml(t('nav.language'))}">${items}</div>`;
}

export function wireLangLinks(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-lang]');
    // Clic modifié (nouvel onglet, etc.) : on laisse faire le navigateur.
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (a.dataset.lang !== currentLang()) setLang(a.dataset.lang);
  });
}

// --- Menu compte ------------------------------------------------------------
// Bouton « initiale » + panneau déroulant (motif « disclosure » : bouton
// aria-expanded qui montre/masque une liste de liens, Tab reste naturel).
// Échap referme et rend le focus au bouton ; ↓/↑ parcourent les entrées.
const initial = (email) => (String(email || '').trim().charAt(0) || '?').toUpperCase();

function avatar(user, on) {
  return `<span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center font-label-md text-label-md ${
    on ? 'bg-primary-container text-on-primary' : 'bg-surface-container border border-outline-variant text-on-surface-variant'
  }" aria-hidden="true">${escapeHtml(initial(user.email))}</span>`;
}

function menuItem(page, href, key, icon, label) {
  const on = page === key;
  return `<a href="${href}" class="${MENU_ITEM}${on ? MENU_ITEM_ON : ''}"${on ? ' aria-current="page"' : ''}>
      <span class="material-symbols-outlined text-[18px] text-outline" aria-hidden="true">${icon}</span><span>${escapeHtml(label)}</span></a>`;
}

function renderAccountMenu(page, user, billing) {
  const on = page === 'account' || page === 'admin';
  const email = escapeHtml(user.email);
  return `
    <div class="relative" data-menu="account">
      <button type="button" data-account-toggle aria-expanded="false" aria-controls="account-menu" title="${email}"
        class="h-9 pl-[4px] pr-xs -mr-xs rounded-full flex items-center gap-[2px] hover:bg-surface-container transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary-container">
        ${avatar(user, on)}
        <span class="sr-only">${escapeHtml(t('nav.accountMenu'))}</span>
        <span class="js-chevron material-symbols-outlined text-[18px] text-outline transition-transform" aria-hidden="true">expand_more</span>
      </button>
      <div id="account-menu" hidden
        class="absolute right-0 top-full mt-xs w-[280px] bg-surface-container-lowest border border-outline-variant rounded-lg shadow-[0_12px_32px_rgba(26,28,28,0.14)] py-xs z-[55]">
        <div class="px-md pt-xs pb-sm mb-xs border-b border-outline-soft flex flex-col min-w-0">
          <span class="font-label-sm text-label-sm text-secondary">${escapeHtml(t('nav.signedInAs'))}</span>
          <span class="font-body-sm text-body-sm text-on-surface truncate" title="${email}">${email}</span>
        </div>
        ${menuItem(page, '/account.html', 'account', 'manage_accounts', t('nav.account'))}
        ${billing ? menuItem(page, '/tarifs.html', 'tarifs', 'sell', t('nav.pricing')) : ''}
        ${user.isAdmin ? menuItem(page, '/admin.html', 'admin', 'admin_panel_settings', t('nav.admin')) : ''}
        <div class="mt-xs px-md py-xs border-t border-outline-soft flex items-center justify-between gap-sm">
          <span class="font-label-sm text-label-sm text-secondary" aria-hidden="true">${escapeHtml(t('nav.language'))}</span>
          ${renderLangCompact()}
        </div>
        <div class="pt-xs border-t border-outline-soft">
          <button type="button" data-action="logout" class="${MENU_ITEM}">
            <span class="material-symbols-outlined text-[18px] text-outline" aria-hidden="true">logout</span><span>${escapeHtml(t('nav.logout'))}</span>
          </button>
        </div>
      </div>
    </div>`;
}

// Même contenu dans le menu mobile, mais à plat : pas de menu dans le menu.
function renderAccountMobile(page, user) {
  const link = (href, key, icon, label) =>
    `<a href="${href}" class="${page === key ? LINK_ON : LINK_OFF} gap-sm"${page === key ? ' aria-current="page"' : ''}><span class="material-symbols-outlined text-[18px] text-outline" aria-hidden="true">${icon}</span>${escapeHtml(label)}</a>`;
  return `
    <div class="flex flex-col gap-xs pt-sm border-t border-outline-soft">
      <div class="flex items-center gap-sm px-md py-xs min-w-0">
        ${avatar(user, page === 'account' || page === 'admin')}
        <span class="flex flex-col min-w-0">
          <span class="font-label-sm text-label-sm text-secondary">${escapeHtml(t('nav.signedInAs'))}</span>
          <span class="font-body-sm text-body-sm text-on-surface truncate">${escapeHtml(user.email)}</span>
        </span>
      </div>
      ${link('/account.html', 'account', 'manage_accounts', t('nav.account'))}
      ${user.isAdmin ? link('/admin.html', 'admin', 'admin_panel_settings', t('nav.admin')) : ''}
      <button type="button" data-action="logout" class="${BTN_GHOST}">
        <span class="material-symbols-outlined text-[16px]" aria-hidden="true">logout</span><span>${escapeHtml(t('nav.logout'))}</span>
      </button>
    </div>`;
}

function renderActions(page, user, cfg, vertical = false, billing = false) {
  const wrap = vertical ? 'flex flex-col gap-sm pt-sm border-t border-outline-soft' : 'flex items-center gap-md';
  if (user) {
    return `
      <div class="${wrap}">
        <span id="usage-header" class="font-label-sm text-label-sm text-secondary ${vertical ? '' : 'hidden xl:block'}">—</span>
        ${page !== 'studio' ? `<a href="/app.html" class="${BTN_PRIMARY}"><span class="material-symbols-outlined text-[16px]">auto_awesome</span><span>${escapeHtml(t('nav.generate'))}</span></a>` : ''}
        ${vertical ? '' : renderAccountMenu(page, user, billing)}
      </div>
      ${vertical ? renderAccountMobile(page, user) : ''}`;
  }
  // Visiteur : l'action principale est d'essayer (inscription), la connexion
  // n'est qu'un lien discret. Inscriptions fermées : la connexion redevient
  // le seul bouton, donc le bouton principal.
  const signup = signupLabel(cfg);
  const login = `<a href="/login.html" class="${signup ? TEXT_LINK : BTN_PRIMARY}">${escapeHtml(t('nav.login'))}</a>`;
  const tryFree = signup ? `<a href="/register.html" class="${BTN_PRIMARY}">${escapeHtml(signup)}</a>` : '';
  if (vertical) return `<div class="${wrap}">${tryFree}${login}</div>`;
  return `
    <div class="flex items-center gap-sm">
      ${renderLangCompact()}
      <span class="w-px h-5 bg-outline-variant mx-xs" aria-hidden="true"></span>
      ${login}
      ${tryFree}
    </div>`;
}

export function renderHeader(page, user, cfg, billing = false) {
  const signup = user ? null : signupLabel(cfg);
  return `
    <div class="w-full max-w-container-max mx-auto px-lg h-[60px] flex items-center justify-between gap-md">
      <div class="flex items-center gap-lg min-w-0">
        <a href="/" class="flex items-center gap-sm shrink-0 min-h-[44px]" aria-label="${escapeHtml(t('nav.homeAria'))}">
          <img src="/img/logo-adcraft.webp" alt="${escapeHtml(t('nav.logoAlt'))}" width="105" height="24" class="h-6 w-auto" />
        </a>
        <nav class="hidden lg:flex items-center gap-xs" aria-label="${escapeHtml(t('nav.mainNav'))}">${renderLinks(page, user, false, billing)}</nav>
      </div>
      <div class="hidden lg:flex items-center gap-md">${renderActions(page, user, cfg, false, billing)}</div>
      <div class="lg:hidden flex items-center gap-sm">
        ${signup ? `<a href="/register.html" class="hidden min-[360px]:flex h-9 px-md rounded bg-primary-container text-on-primary items-center justify-center font-label-md text-label-md hover:bg-primary transition-colors">${escapeHtml(signup)}</a>` : ''}
        <button type="button" data-action="menu" class="w-11 h-11 -mr-sm rounded border border-outline-variant flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors"
          aria-label="${escapeHtml(t('nav.menu'))}" aria-expanded="false" aria-controls="mobile-menu">
          <span class="material-symbols-outlined text-[20px]">menu</span>
        </button>
      </div>
    </div>
    <div id="mobile-menu" hidden class="lg:hidden border-t border-outline-soft bg-surface-container-lowest">
      <div class="px-lg py-md flex flex-col gap-xs">
        <nav class="flex flex-col" aria-label="${escapeHtml(t('nav.mobileNav'))}">${renderLinks(page, user, true, billing)}</nav>
        ${renderActions(page, user, cfg, true, billing)}
        <div class="flex items-center justify-between gap-sm pt-sm border-t border-outline-soft">
          <span class="px-md font-label-sm text-label-sm text-secondary" aria-hidden="true">${escapeHtml(t('nav.language'))}</span>
          ${renderLangCompact()}
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
      ${renderLangCompact()}
    </div>`;
}

// --- Barre d'information cookies --------------------------------------------
// Un seul cookie, strictement nécessaire (session) : il n'appelle aucun
// consentement (directive ePrivacy, art. 5(3)), mais l'information doit rester
// accessible. D'où une barre d'une ligne, fermable, et non plus un encart d'un
// quart d'écran ; le lien « Cookies » du pied de page reste en permanence.
// Même clé qu'avant : qui a fermé l'ancien bandeau ne voit pas la barre.
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
  el.className = 'fixed bottom-0 inset-x-0 z-[60] bg-surface-container-lowest border-t border-outline-soft shadow-[0_-4px_16px_rgba(26,28,28,0.06)]';
  el.innerHTML = `
    <div class="w-full max-w-container-max mx-auto pl-lg pr-sm py-[2px] flex items-center gap-sm">
      <span class="material-symbols-outlined text-outline text-[16px] shrink-0" aria-hidden="true">cookie</span>
      <p class="flex-1 min-w-0 py-xs font-body-sm text-body-sm text-on-surface-variant">
        ${escapeHtml(t('cookies.short'))}
        <a href="/legal.html#cookies" class="text-primary-container underline whitespace-nowrap">${escapeHtml(t('cookies.more'))}</a>
      </p>
      <button type="button" data-action="cookie-ok" aria-label="${escapeHtml(t('cookies.close'))}" title="${escapeHtml(t('cookies.close'))}"
        class="w-11 h-11 lg:w-8 lg:h-8 shrink-0 rounded flex items-center justify-center text-secondary hover:bg-surface-container hover:text-on-surface transition-colors">
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
      </button>
    </div>`;
  // La barre est fixe : on réserve sa hauteur sous la page pour qu'elle ne
  // masque pas le pied de page (CSSOM, autorisé par la CSP).
  const reserve = () => (document.body.style.paddingBottom = `${el.offsetHeight}px`);
  el.querySelector('[data-action="cookie-ok"]').addEventListener('click', () => {
    try {
      localStorage.setItem(COOKIE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    window.removeEventListener('resize', reserve);
    document.body.style.paddingBottom = '';
    el.remove();
  });
  document.body.appendChild(el);
  reserve();
  window.addEventListener('resize', reserve);
}

// --- Bandeau « adresse non confirmée » -------------------------------------
// Non bloquant (contrairement à la modale CGU) : l'utilisateur peut visiter le
// site, mais la génération lui sera refusée tant qu'il n'a pas confirmé.
function verifyBanner(user) {
  if (!user || user.emailVerified !== false) return;
  const el = document.createElement('div');
  el.id = 'verify-banner';
  el.className = 'bg-error-container border-b border-outline-soft';
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

// --- Câblage du menu compte (desktop) ---------------------------------------
function wireAccountMenu(header) {
  const root = header.querySelector('[data-menu="account"]');
  if (!root) return;
  const btn = root.querySelector('[data-account-toggle]');
  const panel = root.querySelector('#account-menu');
  const items = () => [...panel.querySelectorAll('a[href], button:not([disabled])')];
  const setOpen = (open, focus) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    root.querySelector('.js-chevron')?.classList.toggle('rotate-180', open);
    if (open && focus === 'first') items()[0]?.focus();
    if (open && focus === 'last') items().at(-1)?.focus();
    if (!open && focus === 'button') btn.focus();
  };

  btn.addEventListener('click', () => setOpen(panel.hidden));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true, 'first'); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true, 'last'); }
  });
  root.addEventListener('keydown', (e) => {
    if (panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false, 'button'); return; }
    if (!panel.contains(document.activeElement)) return;
    const list = items();
    const i = list.indexOf(document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = list.length - 1;
    if (next >= 0) { e.preventDefault(); list[next].focus(); }
  });
  // Clic ailleurs, ou focus sorti du menu au clavier : on referme.
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !root.contains(e.target)) setOpen(false);
  });
  root.addEventListener('focusout', (e) => {
    if (!panel.hidden && e.relatedTarget && !root.contains(e.relatedTarget)) setOpen(false);
  });
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
    wireLangLinks(header);
    wireAccountMenu(header);
    const menuBtn = header.querySelector('[data-action="menu"]');
    const mobileMenu = header.querySelector('#mobile-menu');
    const setMobile = (open) => {
      mobileMenu.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.querySelector('.material-symbols-outlined').textContent = open ? 'close' : 'menu';
    };
    header.addEventListener('click', async (e) => {
      // Ancre de la même page (#fonctionnement…) depuis le menu mobile : on le
      // referme, sinon il reste ouvert par-dessus la section visée.
      if (e.target.closest('#mobile-menu a[href*="#"]')) setMobile(false);
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'logout') {
        await api.logout().catch(() => {});
        location.href = '/login.html';
      }
      if (btn.dataset.action === 'menu') setMobile(mobileMenu.hidden);
    });
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mobileMenu.hidden) {
        setMobile(false);
        menuBtn.focus();
      }
    });
    if (user) {
      api
        .usage()
        .then((u) => header.querySelectorAll('#usage-header').forEach((el) => (el.textContent = usageLabel(u))))
        .catch(() => {});
    }
  }
  if (footer) {
    footer.innerHTML = renderFooter();
    wireLangLinks(footer);
  }

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
