// Doublure de `shared/prompt.mjs` pour les tests, utilisée UNIQUEMENT si le
// vrai fichier est absent de la copie de travail (il porte toute la logique de
// prompt : THEME_BRIEFS, PRESETS, inventaire multi-produits — rien de tout cela
// n'est nécessaire pour tester l'authentification, les quotas ou la facturation).
//
// Les valeurs reproduisent celles que le backend valide réellement : les sept
// thèmes de frontend/js/components.js et la limite de produits affichée dans le
// studio. Si elles divergeaient du vrai fichier, seuls les tests de génération
// en souffriraient — et il n'y en a pas.
export const THEMES = ['classique', 'ete', 'extravagant', 'sport', 'fete', 'luxe', 'noel'];
export const CATEGORIES = ['Boisson', 'Alimentaire', 'Cosmétique', 'Hygiène', 'Autre'];
export const MAX_PRODUCTS = 6;
