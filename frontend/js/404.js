// Page 404 : chrome commun + sorties adaptées à l'état du compte.
//
// `mountChrome({ requireAuth: false })` : une page d'erreur ne doit JAMAIS
// rediriger vers la connexion. Un visiteur anonyme qui tombe sur un lien mort
// se retrouverait sur un écran de login sans comprendre pourquoi — une impasse
// de plus, alors qu'il en sortait déjà d'une.
import { mountChrome } from './nav.js';
import { api } from './api.js';
import { escapeHtml } from './components.js';
import { t } from './i18n.js';

const BTN_GHOST =
  'min-h-[44px] lg:min-h-0 lg:h-9 px-lg py-xs rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant inline-flex items-center justify-center gap-xs font-label-md text-label-md hover:bg-surface-container transition-colors';

const user = await mountChrome({ requireAuth: false });
const exits = document.getElementById('exits');

if (exits) {
  const links = [];
  if (user) {
    links.push(`<a href="/app.html" class="${BTN_GHOST}">${escapeHtml(t('notFound.studio'))}</a>`);
    links.push(`<a href="/history.html" class="${BTN_GHOST}">${escapeHtml(t('notFound.history'))}</a>`);
  } else {
    links.push(`<a href="/login.html" class="${BTN_GHOST}">${escapeHtml(t('nav.login'))}</a>`);
  }
  // « Tarifs » seulement si la facturation répond : le lien est déjà masqué de
  // la barre de navigation quand elle est coupée (nav.js), le proposer ici
  // mènerait à une page qui annonce que la facturation est désactivée.
  try {
    await api.billing.plans();
    links.push(`<a href="/tarifs.html" class="${BTN_GHOST}">${escapeHtml(t('notFound.pricing'))}</a>`);
  } catch { /* facturation coupée : pas de lien */ }

  exits.insertAdjacentHTML('beforeend', links.join(''));
}
