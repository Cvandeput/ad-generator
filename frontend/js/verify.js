// Page ouverte depuis le lien reçu par e-mail. Le jeton est dans l'URL : on le
// poste au backend (qui le consomme), puis on retire le paramètre de la barre
// d'adresse pour qu'il ne traîne pas dans l'historique.
import { api, ApiError } from './api.js';
import { escapeHtml } from './components.js';

const panel = document.getElementById('panel');
const BTN_PRIMARY = 'h-9 px-lg rounded bg-primary-container text-on-primary flex items-center justify-center font-label-md text-label-md hover:bg-primary transition-colors';
const BTN_GHOST = 'h-9 px-lg rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant flex items-center justify-center font-label-md text-label-md hover:bg-surface-container transition-colors';

function render({ icon, tone, title, text, actions = '' }) {
  panel.innerHTML = `
    <span class="material-symbols-outlined text-[36px] ${tone}">${icon}</span>
    <h1 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h1>
    <p class="font-body-base text-body-base text-secondary">${text}</p>
    <div class="flex gap-sm flex-wrap justify-center pt-xs">${actions}</div>`;
}

const token = new URLSearchParams(location.search).get('token');

if (!token) {
  render({ icon: 'link_off', tone: 'text-error', title: 'Lien incomplet',
    text: 'Ce lien ne contient pas de jeton de confirmation. Ouvrez-le directement depuis l\'e-mail reçu.',
    actions: `<a href="/login.html" class="${BTN_GHOST}">Se connecter</a>` });
} else {
  try {
    await api.verifyEmail(token);
    history.replaceState(null, '', '/verify.html');       // le jeton ne reste pas dans l'URL
    render({ icon: 'mark_email_read', tone: 'text-primary-container', title: 'Adresse confirmée',
      text: 'Votre compte est actif et vos générations offertes sont débloquées.',
      actions: `<a href="/app.html" class="${BTN_PRIMARY}">Ouvrir le studio</a><a href="/tarifs.html" class="${BTN_GHOST}">Voir les formules</a>` });
  } catch (err) {
    history.replaceState(null, '', '/verify.html');
    const expired = err instanceof ApiError && err.status === 400;
    render({ icon: 'link_off', tone: 'text-error', title: expired ? 'Lien invalide ou expiré' : 'Confirmation impossible',
      text: expired
        ? 'Ce lien a déjà servi ou a dépassé sa durée de validité. Demandez-en un nouveau ci-dessous.'
        : escapeHtml(err.message || 'Réessayez dans quelques instants.'),
      actions: `<button type="button" id="resend" class="${BTN_PRIMARY}">Recevoir un nouveau lien</button><a href="/login.html" class="${BTN_GHOST}">Se connecter</a>` });

    document.getElementById('resend')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Envoi…';
      // Connecté : le backend retrouve l'adresse tout seul. Sinon on la demande.
      let email;
      try {
        await api.me({ silent: true });
      } catch {
        email = prompt('Votre adresse e-mail :');
        if (!email) { btn.disabled = false; btn.textContent = 'Recevoir un nouveau lien'; return; }
      }
      try {
        const res = await api.resendVerification(email);
        render({ icon: 'outgoing_mail', tone: 'text-primary-container', title: 'C\'est envoyé',
          text: escapeHtml(res.message || 'Consultez votre boîte de réception.'),
          actions: `<a href="/login.html" class="${BTN_GHOST}">Se connecter</a>` });
      } catch (e2) {
        btn.disabled = false;
        btn.textContent = 'Recevoir un nouveau lien';
        alert(e2.message || 'Envoi impossible');
      }
    });
  }
}
