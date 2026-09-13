// Chrome commun à toutes les pages : barre de navigation (état connecté /
// anonyme, menu mobile), pied de page, bandeau cookies, modale de
// ré-acceptation des mentions légales. Un seul endroit à retoucher.
//
//   <header id="site-header" data-page="home|studio|history|legal"></header>
//   <footer id="site-footer"></footer>
//   import { mountChrome } from './nav.js'; const user = await mountChrome();
import { api } from './api.js';
import { escapeHtml, usageLabel } from './components.js';

const LINK = 'font-label-md text-label-md px-md py-sm rounded transition-colors';
const LINK_OFF = `${LINK} text-secondary hover:text-on-surface`;
const LINK_ON = `${LINK} text-on-surface shadow-[inset_0_-2px_0_#1d4ed8]`;
const BTN_PRIMARY = 'h-8 px-md rounded bg-primary-container text-on-primary flex items-center gap-xs font-label-md text-label-md hover:bg-primary transition-colors';
const BTN_GHOST = 'h-8 px-md rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant flex items-center gap-xs font-label-md text-label-md hover:bg-surface-container transition-colors';

// La facturation est optionnelle côté serveur : on ne montre « Tarifs » que si
// l'API répond. Résultat mis en cache pour l'onglet (une requête par session).
const BILLING_KEY = 'adcraft.billing.v1';
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
  const links = [{ href: '/', key: 'home', label: 'Accueil' }];
  if (page === 'home') {
    links.push({ href: '/#fonctionnement', key: 'fonctionnement', label: 'Fonctionnement' });
    links.push({ href: '/#galerie', key: 'galerie', label: 'Exemples' });
  }
  if (user) {
    links.push({ href: '/app.html', key: 'studio', label: 'Studio' });
    links.push({ href: '/history.html', key: 'history', label: 'Historique' });
  }
  if (billing) links.push({ href: '/tarifs.html', key: 'tarifs', label: 'Tarifs' });
  return links;
}

function renderLinks(page, user, vertical = false, billing = false) {
  return navLinks(page, user, billing)
    .map(
      (l) =>
        `<a href="${l.href}" ${l.key === page ? 'aria-current="page"' : ''} class="${l.key === page ? LINK_ON : LINK_OFF}${vertical ? ' block' : ''}">${l.label}</a>`
    )
    .join('');
}

function renderActions(page, user, cfg, vertical = false) {
  const wrap = vertical ? 'flex flex-col gap-sm pt-sm border-t border-outline-variant' : 'flex items-center gap-md';
  if (user) {
    return `
      <div class="${wrap}">
        <span id="usage-header" class="font-label-sm text-label-sm text-secondary ${vertical ? '' : 'hidden md:block'}">—</span>
        ${page !== 'studio' ? `<a href="/app.html" class="${BTN_PRIMARY}"><span class="material-symbols-outlined text-[16px]">auto_awesome</span><span>Générer</span></a>` : ''}
        <button type="button" data-action="logout" title="Déconnexion (${escapeHtml(user.email)})" aria-label="Déconnexion"
          class="${vertical ? BTN_GHOST : 'w-7 h-7 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors'}">
          <span class="material-symbols-outlined text-[16px]">logout</span>${vertical ? '<span>Déconnexion</span>' : ''}
        </button>
      </div>`;
  }
  const canRegister = cfg && cfg.registerMode && cfg.registerMode !== 'closed';
  return `
    <div class="${wrap}">
      ${canRegister ? `<a href="/register.html" class="${BTN_GHOST}">Créer un compte</a>` : ''}
      <a href="/login.html" class="${BTN_PRIMARY}">Se connecter</a>
    </div>`;
}

export function renderHeader(page, user, cfg, billing = false) {
  return `
    <div class="w-full max-w-container-max mx-auto px-lg h-[60px] flex items-center justify-between gap-md">
      <div class="flex items-center gap-lg min-w-0">
        <a href="/" class="flex items-center gap-sm shrink-0" aria-label="AdCraft — accueil">
          <img src="/img/logo-adcraft.png" alt="AdCraft" width="105" height="24" class="h-6 w-auto" />
        </a>
        <nav class="hidden md:flex items-center gap-xs" aria-label="Navigation principale">${renderLinks(page, user, false, billing)}</nav>
      </div>
      <div class="hidden md:flex items-center">${renderActions(page, user, cfg)}</div>
      <button type="button" data-action="menu" class="md:hidden w-9 h-9 rounded border border-outline-variant flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors"
        aria-label="Menu" aria-expanded="false" aria-controls="mobile-menu">
        <span class="material-symbols-outlined text-[20px]">menu</span>
      </button>
    </div>
    <div id="mobile-menu" hidden class="md:hidden border-t border-outline-variant bg-surface-container-lowest">
      <div class="px-lg py-md flex flex-col gap-xs">
        <nav class="flex flex-col" aria-label="Navigation mobile">${renderLinks(page, user, true, billing)}</nav>
        ${renderActions(page, user, cfg, true)}
      </div>
    </div>`;
}

export function renderFooter() {
  return `
    <div class="w-full max-w-container-max mx-auto px-lg py-lg flex flex-col md:flex-row justify-between items-center gap-md">
      <span class="font-label-sm text-label-sm text-outline">© ${new Date().getFullYear()} AdCraft</span>
      <nav class="flex flex-wrap justify-center gap-lg" aria-label="Liens légaux">
        <a class="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors" href="/legal.html#mentions">Mentions légales</a>
        <a class="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors" href="/legal.html#confidentialite">Confidentialité</a>
        <a class="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors" href="/legal.html#cookies">Cookies</a>
        <a class="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors" href="/legal.html#cgu">CGU</a>
        <a class="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors" href="/legal.html#contact">Contact</a>
      </nav>
    </div>`;
}

// --- Bandeau cookies : uniquement des cookies techniques (session), donc pas
// de consentement à recueillir — un bandeau d'information, mémorisé localement.
const COOKIE_KEY = 'adcraft.cookieNotice.v1';
function cookieBanner() {
  try {
    if (localStorage.getItem(COOKIE_KEY)) return;
  } catch {
    /* stockage indisponible : on affiche à chaque fois */
  }
  const el = document.createElement('div');
  el.id = 'cookie-banner';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Information cookies');
  el.className = 'fixed bottom-md left-md right-md md:left-auto md:right-lg md:max-w-[420px] z-[60] bg-surface-container-lowest border border-outline-variant rounded-lg shadow-[0_12px_32px_rgba(26,28,28,0.14)] p-md flex flex-col gap-sm';
  el.innerHTML = `
    <div class="flex items-start gap-sm">
      <span class="material-symbols-outlined text-outline text-[20px]">cookie</span>
      <p class="font-body-sm text-body-sm text-on-surface-variant">AdCraft n'utilise qu'un cookie technique de session, indispensable pour vous garder connecté. Aucun cookie publicitaire ni de suivi. <a href="/legal.html#cookies" class="text-primary-container underline">En savoir plus</a></p>
    </div>
    <div class="flex justify-end">
      <button type="button" data-action="cookie-ok" class="${BTN_PRIMARY}">J'ai compris</button>
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
        Confirmez votre adresse <strong>${escapeHtml(user.email)}</strong> pour débloquer vos générations offertes. Pensez aux indésirables.
      </span>
      <button type="button" data-action="resend" class="h-8 px-md rounded border border-on-error-container/40 bg-surface-container-lowest text-on-surface-variant font-label-md text-label-md hover:bg-surface-container transition-colors">
        Renvoyer l'e-mail
      </button>
    </div>`;
  el.querySelector('[data-action="resend"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Envoi…';
    try {
      await api.resendVerification();
      btn.textContent = 'E-mail envoyé';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Renvoyer l'e-mail";
      alert(err.message || 'Envoi impossible');
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
      <h2 id="terms-title" class="font-headline-md text-headline-md text-on-surface">Mentions légales et CGU</h2>
      <p class="font-body-base text-body-base text-on-surface-variant">Pour continuer à utiliser AdCraft, merci de prendre connaissance et d'accepter les <a href="/legal.html#mentions" target="_blank" rel="noopener" class="text-primary-container underline">mentions légales</a>, la <a href="/legal.html#confidentialite" target="_blank" rel="noopener" class="text-primary-container underline">politique de confidentialité</a> et les <a href="/legal.html#cgu" target="_blank" rel="noopener" class="text-primary-container underline">conditions d'utilisation</a>.</p>
      <label class="flex items-start gap-sm cursor-pointer">
        <input type="checkbox" id="terms-check" class="mt-[2px] rounded border-outline-variant text-primary-container focus:ring-primary-container" />
        <span class="font-body-sm text-body-sm text-on-surface">J'ai lu et j'accepte ces documents.</span>
      </label>
      <p id="terms-error" class="font-body-sm text-body-sm text-error hidden"></p>
      <div class="flex justify-end gap-sm">
        <button type="button" data-action="terms-logout" class="${BTN_GHOST}">Me déconnecter</button>
        <button type="button" data-action="terms-accept" class="${BTN_PRIMARY}" disabled>Accepter et continuer</button>
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
      error.textContent = err.message || 'Échec, réessayez.';
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
