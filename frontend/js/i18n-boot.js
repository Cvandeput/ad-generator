/* Amorce i18n — script CLASSIQUE et BLOQUANT, chargé en tout premier dans le
   <head> de chaque page. Pas un module : les modules ES sont différés par
   nature, ils s'exécutent après l'analyse du document, donc trop tard pour
   éviter le FOUC de traduction (français affiché, puis remplacé sous les yeux
   de l'utilisateur).

   Rôle unique : masquer le document le temps de l'hydratation. Aucune chaîne,
   aucune détection de langue ici — tout cela vit dans js/i18n.js, qui appelle
   __i18nReveal() quand le DOM est traduit (succès comme échec).

   Pourquoi un fichier et pas un <script> inline : la CSP du service est stricte
   et interdit scripts et styles inline (cf. README + nginx/snippets). On masque
   donc via CSSOM (element.style.*), que la CSP ne restreint pas — contrairement
   à une balise <style> ou à un attribut style écrit dans le HTML.

   GARDE-FOU : si i18n.js ne se charge pas (réseau coupé, erreur de parsing,
   dictionnaire absent), personne ne rappellera __i18nReveal(). Le minuteur
   ci-dessous réaffiche la page quoi qu'il arrive : au pire l'utilisateur voit
   le français de référence écrit dans le HTML, jamais une page blanche. Et si
   JavaScript est désactivé, ce script ne s'exécute pas : rien n'est masqué. */
(function (d) {
  var root = d.documentElement;
  var revealed = false;

  function reveal() {
    if (revealed) return;
    revealed = true;
    root.style.visibility = '';
    root.removeAttribute('data-i18n-booting');
  }

  root.style.visibility = 'hidden';
  root.setAttribute('data-i18n-booting', '');
  window.__i18nReveal = reveal;

  setTimeout(reveal, 1200); // filet : au-delà, on montre la page en l'état.
})(document);
