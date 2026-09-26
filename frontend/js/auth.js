// Page de connexion. Le lien « Créer un compte » n'apparaît que si le backend
// autorise l'inscription (REGISTER_MODE=invite|open).
import { api, ApiError } from './api.js';
import { t, currentLang, DEFAULT_LANG } from './i18n.js';
import { renderLangCompact, wireLangLinks } from './nav.js';
import { escapeHtml } from './components.js';

// Ces pages hors chrome commun (pas de <header id="site-header">) portent tout
// de même le sélecteur de langue : sans lui, on ne peut plus changer de langue
// une fois arrivé directement sur /login.html.
const slot = document.getElementById('lang-slot');
if (slot) {
  slot.innerHTML = renderLangCompact();
  wireLangLinks(slot);
}

const form = document.getElementById('auth-form');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('error');
const hint = document.getElementById('register-hint');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  try {
    await api.login(form.email.value.trim(), form.password.value);
    window.location.href = '/app.html';
  } catch (err) {
    // Identifiants refusés : le serveur répond 400/401 SANS code métier, et
    // api.js traduirait alors par le statut (« Session expirée »), faux ici.
    // En français on garde le message du serveur, comme partout ailleurs.
    const badCredentials = err instanceof ApiError && (err.status === 400 || err.status === 401);
    if (badCredentials && !(currentLang() === DEFAULT_LANG && err.serverMessage)) showError(t('login.badCredentials'));
    else showError(err instanceof ApiError ? err.message : t('errors.generic'));
    submitBtn.disabled = false;
  }
});

// Déjà connecté → studio. (silent : pas de redirection parasite vers /login.)
api
  .me({ silent: true })
  .then(() => {
    window.location.href = '/app.html';
  })
  .catch(() => {});

api
  .config()
  .then((cfg) => {
    if (!hint || !cfg || cfg.registerMode === 'closed') return;
    hint.innerHTML = `
      <span class="material-symbols-outlined text-outline text-[18px]" aria-hidden="true">person_add</span>
      <span class="font-body-sm text-body-sm text-on-surface-variant">${t('login.noAccount_html')}${cfg.registerMode === 'invite' ? escapeHtml(t('login.inviteRequired')) : ''}.
      </span>`;
  })
  .catch(() => {});
