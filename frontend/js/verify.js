// Page ouverte depuis le lien reçu par e-mail. Le jeton est dans l'URL : on le
// poste au backend (qui le consomme), puis on retire le paramètre de la barre
// d'adresse pour qu'il ne traîne pas dans l'historique.
import { api, ApiError } from './api.js';
import { escapeHtml } from './components.js';
import { t, currentLang, DEFAULT_LANG, renderLanguageSwitch, wireLanguageSwitch } from './i18n.js';

const slot = document.getElementById('lang-slot');
if (slot) {
  slot.innerHTML = renderLanguageSwitch({ id: 'lang-verify' });
  wireLanguageSwitch(slot);
}

const panel = document.getElementById('panel');
const BTN_PRIMARY = 'h-11 lg:h-9 px-lg rounded bg-primary-container text-on-primary flex items-center justify-center font-label-md text-label-md hover:bg-primary transition-colors';
const BTN_GHOST = 'h-11 lg:h-9 px-lg rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant flex items-center justify-center font-label-md text-label-md hover:bg-surface-container transition-colors';

function render({ icon, tone, title, text, actions = '' }) {
  panel.innerHTML = `
    <span class="material-symbols-outlined text-[36px] ${tone}" aria-hidden="true">${icon}</span>
    <h1 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h1>
    <p class="font-body-base text-body-base text-secondary">${text}</p>
    <div class="flex gap-sm flex-wrap justify-center pt-xs">${actions}</div>`;
}

const params = new URLSearchParams(location.search);
const token = params.get('token');

// Retire le jeton de l'URL en gardant le reste (?lang=…). Sur succès, `ok=1`
// mémorise l'état : changer de langue recharge la page (setLang), qui sans lui
// n'aurait plus de jeton et afficherait « Lien incomplet ». Ce paramètre ne fait
// qu'afficher un message, il ne confirme rien côté serveur.
function cleanUrl({ ok = false } = {}) {
  const u = new URL(location.href);
  u.searchParams.delete('token');
  if (ok) u.searchParams.set('ok', '1');
  return u.pathname + u.search + u.hash;
}

function renderDone() {
  render({ icon: 'mark_email_read', tone: 'text-primary-container', title: t('verify.done.title'),
    text: escapeHtml(t('verify.done.text')),
    actions: `<a href="/app.html" class="${BTN_PRIMARY}">${escapeHtml(t('pricing.current.openStudio'))}</a><a href="/tarifs.html" class="${BTN_GHOST}">${escapeHtml(t('studio.quota.cta'))}</a>` });
}

if (!token && params.get('ok') === '1') {
  renderDone();
} else if (!token) {
  render({ icon: 'link_off', tone: 'text-error', title: t('verify.incomplete.title'),
    text: escapeHtml(t('verify.incomplete.text')),
    actions: `<a href="/login.html" class="${BTN_GHOST}">${escapeHtml(t('nav.login'))}</a>` });
} else {
  try {
    await api.verifyEmail(token);
    history.replaceState(null, '', cleanUrl({ ok: true })); // le jeton ne reste pas dans l'URL
    renderDone();
  } catch (err) {
    history.replaceState(null, '', cleanUrl());
    const expired = err instanceof ApiError && err.status === 400;
    render({ icon: 'link_off', tone: 'text-error', title: expired ? t('verify.expired.title') : t('verify.failed.title'),
      text: escapeHtml(expired ? t('verify.expired.text') : err.message || t('verify.failed.text')),
      actions: `<button type="button" id="resend" class="${BTN_PRIMARY}">${escapeHtml(t('verify.resend'))}</button><a href="/login.html" class="${BTN_GHOST}">${escapeHtml(t('nav.login'))}</a>` });

    document.getElementById('resend')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = t('common.sending');
      // Connecté : le backend retrouve l'adresse tout seul. Sinon on la demande.
      let email;
      try {
        await api.me({ silent: true });
      } catch {
        email = prompt(t('verify.askEmail'));
        if (!email) { btn.disabled = false; btn.textContent = t('verify.resend'); return; }
      }
      try {
        const res = await api.resendVerification(email);
        render({ icon: 'outgoing_mail', tone: 'text-primary-container', title: t('verify.sent.title'),
          // Message du serveur en français : hors FR, notre clé.
          text: escapeHtml((currentLang() === DEFAULT_LANG && res.message) || t('verify.sent.text')),
          actions: `<a href="/login.html" class="${BTN_GHOST}">${escapeHtml(t('nav.login'))}</a>` });
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = t('verify.resend');
        alert(e2.message || t('verifyBanner.failed'));
      }
    });
  }
}
