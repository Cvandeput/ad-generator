// Page d'erreur serveur. Aucun appel à l'API : c'est justement elle qui ne
// répond pas. On se limite au sélecteur de langue et au bouton « Réessayer ».
import { renderLanguageSwitch, wireLanguageSwitch } from './i18n.js';

const slot = document.getElementById('lang-slot');
if (slot) {
  slot.innerHTML = renderLanguageSwitch({ id: 'lang-50x' });
  wireLanguageSwitch(slot);
}

// location.reload() et pas un lien vers « / » : le visiteur veut la page qu'il
// demandait, pas l'accueil. Si le service est revenu, il y arrive directement.
document.getElementById('retry')?.addEventListener('click', () => location.reload());
