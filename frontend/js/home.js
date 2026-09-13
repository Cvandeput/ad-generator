// Page d'accueil : chrome commun (nav connectée ou non, footer, cookies).
import { mountChrome } from './nav.js';

mountChrome({ requireAuth: false }).then((user) => {
  // Anonyme : le bouton principal du hero renvoie vers la connexion.
  if (!user) {
    document.querySelectorAll('a[href="/app.html"]').forEach((a) => {
      a.setAttribute('href', '/login.html');
      if (a.textContent.trim() === 'Ouvrir le studio') a.textContent = 'Se connecter';
    });
  }
});
