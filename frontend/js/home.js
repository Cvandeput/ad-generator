// Page d'accueil : chrome commun (nav connectée ou non, footer, cookies).
import { mountChrome } from './nav.js';
import { t } from './i18n.js';
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

mountChrome({ requireAuth: false }).then((user) => {
  // Anonyme : le bouton principal du hero renvoie vers la connexion. On cible
  // le bouton par son data-cta, pas par son libellé — celui-ci est traduit.
  if (!user) {
    document.querySelectorAll('a[href="/app.html"]').forEach((a) => {
      a.setAttribute('href', '/login.html');
      if (a.dataset.cta === 'studio') a.textContent = t('nav.login');
    });
  }
});
