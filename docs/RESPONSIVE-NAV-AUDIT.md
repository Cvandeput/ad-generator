# Audit navigation / responsive / accessibilité — AdCraft

Périmètre : `frontend/*.html` et `frontend/js/*.js` uniquement.
`css/input.css`, `tailwind.config.js` et `backend/` n'ont **pas** été modifiés (travail d'autres
agents : calque de grain, token `outline` corrigé à `#646674`). `css/app.css` est régénéré.
Les attributs `src`/`href` d'images (migration `.webp`) n'ont pas été touchés.

## Méthode

Harnais rejouable `/tmp/claude-0/harness/` : `server.js` sert `frontend/` et stube `/api/*`
(utilisateur `isAdmin: true` par défaut, bascule de scénario par `POST /__state`).

| script | rôle |
|---|---|
| `resp.js <tag>` | 10 pages × 6 largeurs (390 / 768 / 820 / 1024 / 1280 / 1440) : `scrollWidth` vs `clientWidth`, éléments débordants, cibles tactiles < 44 px, captures dans `shots/<tag>/` |
| `audit.js <out>` | axe-core `color-contrast` sur 24 scénarios × 2 viewports, passe normale **et** passe `:hover`/`:focus` forcés via CDP |
| `sem.js` | un seul `<h1>`, hiérarchie sans saut, `alt`, nom accessible des champs et des boutons icône seule, `lang` |

Règles d'attribution des cibles tactiles (WCAG 2.5.5 / 2.5.8) :
une case à cocher enveloppée par un `<label>` est mesurée sur le label ; un `<label for>` qui
n'enveloppe rien n'est pas la cible primaire (le champ l'est) ; un lien en ligne dans une phrase
relève de l'exception « inline » et est exclu.

**Limite du bac à sable** : aucun accès réseau, donc Google Fonts ne charge pas. Inter et Space
Grotesk retombent sur DejaVu Sans, **plus large** que l'original — les mesures de débordement sont
donc pessimistes. Les ligatures Material Symbols sont remplacées par un carré de 1 em (la métrique
réelle d'un glyphe d'icône) ; sans ce correctif le mot `auto_awesome` s'affichait en toutes lettres
et faussait toutes les largeurs. Les captures montrent des carrés blancs à la place des icônes :
c'est le harnais, pas le site.

---

## 1. Bug signalé : pas de navbar sur `admin.html`

> « quand je suis dans le menu administration je ne peux pas revenir sur les pages de génération,
> d'accueil car il n'y a pas de navbar »

**Cause.** `js/admin.js` était le seul script de page à n'appeler jamais `mountChrome()`. Il
utilisait `requireUser()` (simple garde 401) au lieu du contrat commun. Résultat : `<header
id="site-header">` et `<footer id="site-footer">` restaient vides — mesuré à **0 octet** de contenu
aux 6 largeurs. Aucune sortie depuis la console d'admin sans retaper l'URL.

`admin.html` avait déjà `data-page="admin"` et `navLinks()` gérait déjà la clé `admin` : le seul
maillon manquant était l'appel.

**Correctif** (`js/admin.js`) :

```js
import { mountChrome } from './nav.js';   // remplace requireUser

(async () => {
  const user = await mountChrome({ requireAuth: true });
  if (!user) return;                       // 401 : redirection /login.html déjà partie
  try { await Promise.all([loadOverview(), loadUsers(), loadGenerations()]); }
  catch (err) { fail(err); }
})();
```

`mountChrome({ requireAuth: true })` appelle `api.me()` sans `silent`, donc le 401 redirige vers
`/login.html` exactement comme `requireUser()` — la garde d'authentification est conservée, et la
valeur de retour (`user` ou `null`) évite de lancer trois requêtes admin après une redirection.
Le `<script src="/js/nav.js">` en double dans `admin.html` a été retiré : `admin.js` l'importe.

**Preuve, après correctif** (`resp.js`, toutes largeurs) :

| | avant | après |
|---|---|---|
| `#site-header` | 0 octet | 5 013 octets |
| `#site-footer` | 0 octet | 1 465 octets |
| liens rendus | — | `/` · `/app.html` · `/history.html` · `/tarifs.html` · `/admin.html` (+ CTA `/app.html`), en barre desktop **et** dans le menu déroulant |

**Aucune autre page n'avait le même oubli** : `home.js`, `app.js`, `history.js`, `tarifs.js`,
`legal.js` appellent tous `mountChrome()`. `login.html`, `register.html` et `verify.html` n'ont
délibérément ni `#site-header` ni `#site-footer` (pages d'authentification autonomes, chrome
propre) — vérifié, laissé en l'état.

---

## 2. Responsive — problèmes trouvés et correctifs

### 2.1 Le trou tablette : la barre de navigation basculait à `md` (768)

C'était le défaut structurant. Entre 768 et 1023 px la tablette recevait la **barre desktop**
complète : logo + 5 à 7 liens + compteur de consommation + bouton « Générer » + déconnexion.

Mesuré à 768 px, page d'accueil connecté : côté gauche 519 px (logo 105 + liens 390 + gouttières),
côté droit 315 px (compteur ~145 + Générer + déconnexion) → **850 px pour 720 px utilisables**.
Le flex ne débordait pas la page (donc `scrollWidth` restait propre, d'où l'invisibilité du bug à
la mesure) mais **écrasait et superposait** les éléments. Constaté sur capture à 768, 820 **et
1024** px : « 12 images · 0,48 € ce mois » cassé sur 4 lignes par-dessus « Historique » et
« Admin », bouton « Générer » chevauchant « Admin », pastille de déconnexion tronquée au bord droit.

**Correctif** (`js/nav.js`) : bascule du menu à `lg` (1024) au lieu de `md` (768).
`hidden md:flex` → `hidden lg:flex` (nav et actions), `md:hidden` → `lg:hidden` (bouton menu et
tiroir). La tablette portrait reçoit désormais le menu déroulant, qui est la bonne réponse :
7 entrées ne tiennent pas sur 720 px.

Restait le chevauchement à 1024 px sur l'accueil connecté (liens d'ancre « Fonctionnement » et
« Exemples » en plus). Le compteur de consommation passe donc à `hidden xl:block` : masqué dans la
barre entre 1024 et 1279, toujours présent dans le menu déroulant où il a sa propre ligne.
Arithmétique après correctif à 1024 px : 743 + 143 + 16 = **902 px pour 976 utilisables**.

### 2.2 `index.html`

| largeur | problème | correctif |
|---|---|---|
| 1024–1279 | Hero : `lg:w-[620px]` figé laissait **292 px** au `<h1>` en `text-display-xl` (52 px) → titre sur 6 lignes, hauteur de hero doublée | `lg:w-[46%] xl:w-[620px]`, `gap-12 lg:gap-16` → `gap-12 xl:gap-16`. Titre sur 3 lignes, texte à 463 px |
| 768–1023 | Bloc avant/après étiré sur 720 px sous le texte | `md:max-w-[620px]` + centrage (le parent est déjà `items-center`) |
| 768–1023 | « Trois informations » : `md:grid-cols-3` → 3 colonnes de **224 px** pour des paragraphes de 4 lignes | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| 768–1023 | Galerie : `md:grid-cols-4` → vignettes 4:5 de **162 px** | `grid-cols-2 lg:grid-cols-4`, `gap-lg lg:gap-xl` (2 colonnes de 348 px sur tablette) |
| 1024–1279 | Section « Fidélité » : même figement que le hero (`lg:w-[560px]`) | `lg:w-[42%] xl:w-[560px]` + `md:max-w-[560px]` |
| 390 | `h-[42px]` sur les deux CTA du hero (sous 44) | `h-11` |

`text-display-lg md:text-display-xl` conservé : à 390 px le titre fait 32 px et tient sur 3 lignes
sans déborder ; à 768 px la colonne est pleine largeur, 52 px passent sans problème.

### 2.3 `tarifs.html`

`grid-cols-1 md:grid-cols-2 lg:grid-cols-4` **conservé** : vérifié sur capture à 768 et 820 px, les
4 formules en 2 colonnes tiennent, la 4e carte est complète et le badge « Recommandé » en
`absolute -top-[11px]` n'est pas coupé (l'écart de ligne `gap-lg` = 24 px lui laisse la place, et
aucun conteneur n'a `overflow-hidden`).

Correctifs : boutons de formule `h-9` (36 px) → `min-h-[44px] lg:min-h-0 lg:h-9` avec
`text-center leading-tight` (le libellé « Changer pour cette formule » passe sur deux lignes dans
une carte en 4 colonnes) ; `<summary>` de la FAQ, **16 px de haut**, → `py-md lg:py-0` (48 px au
doigt).

### 2.4 `app.html` (studio)

| largeur | problème | correctif |
|---|---|---|
| 390–1023 | Tous les champs en `h-9` (**36 px**), bouton « Générer » en `h-10` (40 px) | `h-11 lg:h-9` / `h-11 lg:h-10` |
| 390–1023 | `<summary>` « Précisez le décor » : **18 px** de haut | `min-h-[44px] lg:min-h-0` |
| 390–1023 | Lien « Conditions d'utilisation » sous le bouton : **14 px** de haut, cible autonome (pas en ligne dans une phrase) | `inline-flex items-center min-h-[44px] lg:min-h-0` |
| 768–1023 | Panneau de réglages étiré sur 720 px : champ « Marque » de **670 px** de large | `md:max-w-[620px] md:self-center lg:max-w-none lg:self-auto` sur le panneau **et** sur la toile, pour garder une colonne cohérente |
| 768–1023 | Grille des 7 thèmes en `grid-cols-4` : 2 rangées dont une à moitié vide sur un panneau large | `grid-cols-4 md:grid-cols-7 lg:grid-cols-4` |
| 390 | Bouton « retirer » d'une vignette uploadée : **16 × 16 px** et `opacity-0 group-hover:opacity-100` → **inatteignable au doigt** (pas de `:hover` en tactile) | `w-6 h-6 lg:w-4 lg:h-4`, `opacity-100 lg:opacity-0 lg:group-hover:opacity-100` (`js/app.js`) |

La mise en page à deux panneaux reste en `lg:flex-row` : à 768 px un panneau de 400 px ne laisserait
que 296 px à la toile, l'empilement est le bon choix.

### 2.5 `history.html`

| largeur | problème | correctif |
|---|---|---|
| 768–1023 | Barre d'outils en `md:flex-row` : le champ de recherche tombait à **118 px** et le placeholder « Rechercher une marque… » était **tronqué** (visible sur capture) | `flex-col lg:flex-row`, `w-full lg:flex-1`, `w-full lg:w-auto` → recherche pleine largeur, filtres sur leur propre ligne |
| 390–1023 | Filtres et « Réinitialiser » en `h-[34px]` | `h-11 lg:h-[34px]`, + `flex-1 lg:flex-none` sur les selects pour qu'ils se répartissent au lieu de déborder de la ligne |
| 390–1023 | Actions d'une vignette (`télécharger` / `supprimer`) : **30 × 30 px** et `opacity-0 group-hover:opacity-100` → **inatteignables au doigt** | cible `w-11 h-11` avec pastille visuelle de 30 px conservée ; `opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100` (le `focus-within` corrige aussi l'invisibilité clavier sur desktop) ; dégradé sombre repoussé en `lg:` (inutile en tactile) |
| 390 | Ligne d'échec en `justify-between` : les deux boutons écrasaient le texte | `flex-col sm:flex-row` (`js/components.js`) |
| 390–1023 | `<summary>` du bandeau d'échecs, 32 px | `min-h-[44px] lg:min-h-0` |

Les tableaux larges (`min-w-[640px]`) étaient déjà dans des conteneurs `overflow-x-auto` : pas de
scroll horizontal de page, scroll interne conservé.

### 2.6 `admin.html`

- Les 4 conteneurs `overflow-x-auto` reçoivent `tabindex="0" role="region" aria-label="…"` : une
  zone défilable doit être atteignable au clavier et annoncée (même exigence appliquée au tableau
  des cookies de `legal.html`).
- Boutons d'action de ligne (`+10`, `−10`, `Vérifier`, `Supprimer`…) : **24 px** de haut →
  `inline-flex items-center justify-center min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0`.
- `#search` et `#gen-status` : `w-full sm:w-auto h-11 lg:h-9`, et bordure `outline-variant` →
  `outline` (cf. §3).
- Valeur des cartes de chiffres : `text-headline-md sm:text-display-lg` — à 390 px, deux colonnes,
  32 px sur « 15,16 € » ne tenaient pas dans les 113 px de contenu d'une carte.

### 2.7 `login.html` / `register.html` / `verify.html` / `legal.html`

Champs et boutons `h-[40px]` → `h-11 lg:h-[40px]` ; liens de retour et logo (24 et 18 px de haut)
→ `min-h-[44px]` ; case à cocher des CGU `w-4 h-4` → `w-5 h-5 shrink-0` (la cible réelle reste le
`<label>` enveloppant, de la largeur du bloc) ; rangées de liens de pied de page (14 px de haut,
« CGU » 24 px de large) → `inline-flex items-center justify-center min-h-[44px] min-w-[44px]
lg:min-h-0 lg:min-w-0` ; sommaire de `legal.html` (16 px de haut) idem.

---

## 3. Accessibilité

### 3.1 Contraste — les 36 violations restantes

Toutes venaient du même endroit : un wrapper `opacity-60` sur la toile vide du studio, dupliqué
dans `app.html` et dans `showEmpty()` de `js/app.js`.

| élément | avant | après |
|---|---|---|
| icône `auto_awesome` 48 px | `#dcdce7` sur `#ffffff` — **1.36:1** (3:1 requis) | `text-outline-variant` → `text-outline`, `opacity-60` retiré : `#646674` sur `#ffffff` — **5.68:1** |
| phrase d'aide `text-secondary` | `#a19e9d` sur `#ffffff` — **2.66:1** | `#625d5b` sur `#ffffff` — **6.15:1** |
| titre « Toile de création » | `#767777` sur `#ffffff` — **4.49:1** | `#1a1c1c` sur `#ffffff` — **16.1:1** |

**axe-core `color-contrast`, 24 scénarios × 2 viewports, passe normale + passe `:hover`/`:focus` :**

| | avant | après |
|---|---|---|
| passe normale | 18 | **0** |
| passe `:hover`/`:focus` | 18 | **0** |
| **total** | **36** | **0** |

### 3.2 Focus clavier (WCAG 2.4.7)

`js/components.js` — les tuiles de thème portaient `focus:outline-none` **sans remplacement** :
le focus clavier était purement invisible. Remplacé par
`rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary-container
focus-visible:ring-offset-2` (`outline-none` de Tailwind pose `outline: 2px solid transparent`,
donc le contour reste visible en mode contraste élevé de Windows).

Ajout connexe : `lg:group-focus-within:opacity-100` sur les actions de vignette d'historique, qui
n'étaient révélées qu'au survol — donc invisibles au clavier.

### 3.3 Contraste non textuel (WCAG 1.4.11, 3:1)

`border-outline-variant` (`#c4c5d7`) est à **1.71:1** sur blanc. Remplacé par `border-outline`
(`#646674`, **5.68:1**) **sur les seuls contrôles de saisie** :

| fichier | contrôles |
|---|---|
| `app.html` | `#brand`, `#category`, `#flavor`, `#product-count`, `#description`, `#art-direction`, `#dropzone` |
| `history.html` | `#f-brand`, `#f-category`, `#f-theme`, `#f-sort` |
| `login.html` | `#email`, `#password` |
| `register.html` | `#invite`, `#email`, `#password`, `#password2`, `#terms` |
| `admin.html` | `#search`, `#gen-status` |
| `js/nav.js` | `#terms-check` (modale CGU) |
| `js/app.js` | bouton « retirer » d'une vignette |

Les bordures de cartes, panneaux, `h-px` et `border-t` de tableau restent en `outline-variant` :
séparateurs décoratifs, hors 1.4.11.

`js/nav.js` — bandeau « adresse non confirmée » : `border-on-error-container/40` (**2.21:1**) →
`border-on-error-container` (**7.24:1**).

### 3.4 Classes mortes dans `admin.html`

`font-display-sm` / `text-display-sm` n'existent **ni** dans `theme.extend.fontFamily` **ni** dans
`theme.extend.fontSize` de `tailwind.config.js`, et ne sont donc pas émises dans `app.css`.
Mesuré au rendu : les 4 `<h2>` de section et la valeur des cartes de chiffres sortaient en
**16 px / poids 400 / Inter**, c'est-à-dire en corps de texte. Remplacé côté HTML (la config est
hors périmètre) :

- `<h2>` × 4 → `font-headline-md text-headline-md` (20 px / 600 / Space Grotesk), cohérent avec les
  `<h2>` de `tarifs.html` et `legal.html` ;
- valeur des cartes (`js/admin.js`) → `font-display-lg text-headline-md sm:text-display-lg`.

### 3.5 Sémantique (`sem.js`, 10 pages)

| contrôle | résultat |
|---|---|
| `lang` | `fr` partout |
| un seul `<h1>` visible | OK sur les 10 pages |
| hiérarchie sans saut | OK — `app.html` corrigé : les 3 intertitres du panneau (`Photos du produit`, `Produit`, `Thème de mise en scène`) étaient des `<span>`, la page n'avait qu'un `<h1>` en `sr-only` → passés en `<h2>` (style inchangé) |
| `alt` sur toutes les images | OK |
| nom accessible des champs | corrigé : `#f-brand`, `#f-category`, `#f-theme`, `#f-sort` (`history.html`), `#search`, `#gen-status` (`admin.html`), `#art-direction` (`app.html`) n'en avaient aucun → `aria-label` |
| boutons icône seule | OK (`Menu`, `Déconnexion`, `Retirer`, `Télécharger`, `Supprimer` avaient déjà leur `aria-label`) |
| icônes décoratives | `aria-hidden="true"` ajouté sur `arrow_back`, `arrow_forward`, `info`, `person_add`, `search`, `radio_button_unchecked`, `hourglass_top` (doublons du texte adjacent) |
| **total anomalies** | **0** |

---

## 4. Résultats mesurés

### Scroll horizontal — `document.documentElement.scrollWidth <= clientWidth`

10 pages × 6 largeurs = **60 couples : 0 débordement**, avant comme après.
À dire clairement : ce critère était **déjà vert avant** correction. Les défauts réels de la barre
de navigation à 768–1024 px étaient des **chevauchements** et du **texte tronqué** à l'intérieur de
conteneurs flex, que `scrollWidth` ne voit pas — ils ont été trouvés à la capture, pas à la mesure.
Les deux cas de troncature constatés (« Recherch| » dans `history.html` à 768 px, compteur de
consommation cassé sur 4 lignes par-dessus les liens) ont disparu.

### Cibles tactiles < 44 × 44 px, largeurs 390 / 768 / 820

Même métrique appliquée avant et après (hors `<label for>` non enveloppant, hors lien `sr-only`,
hors lien en ligne dans une phrase, case à cocher mesurée sur son `<label>`) :

| page | avant (390 / 768 / 820) | après |
|---|---|---|
| `index.html` connecté | 10 / 18 / 18 | 0 / 0 / 0 |
| `index.html` anonyme | 10 / 15 / 15 | 0 / 0 / 0 |
| `tarifs.html` | 19 / 25 / 25 | 0 / 0 / 0 |
| `app.html` | 10 / 15 / 15 | 0 / 0 / 0 |
| `history.html` | 26 / 32 / 32 | 0 / 0 / 0 |
| `admin.html` | 18 / 18 / 18 | 0 / 0 / 0 |
| `login.html` | 4 / 4 / 4 | 0 / 0 / 0 |
| `register.html` | 9 / 9 / 9 | 0 / 0 / 0 |
| `legal.html` | 13 / 19 / 19 | 0 / 0 / 0 |
| `verify.html` | 5 / 5 / 5 | 0 / 0 / 0 |
| **total** | **444** | **0** |

### axe-core `color-contrast`

**36 → 0** (détail §3.1). Aucune erreur JS levée sur aucune page à aucune largeur.

---

## 5. Hors périmètre / non fait

1. **Cibles tactiles à partir de 1024 px.** Le seuil de 44 px s'applique **sous `lg`**. À 1024 px et
   au-delà, la maquette compacte reprend : liens de barre 44 px de haut (gratuit, l'en-tête fait
   60 px) et cible de 44 px sur la déconnexion icône seule, mais les boutons secondaires
   redescendent à 32–36 px. Un iPad Pro en paysage (1024 px, tactile) reçoit donc la barre desktop
   avec des cibles de 32 px. Le correctif propre n'est pas une affaire de largeur mais de type de
   pointeur : un bloc `@media (pointer: coarse) { … }` dans `css/input.css`, ou un écran
   personnalisé dans `tailwind.config.js` — **les deux hors de mon périmètre**. Contourner par des
   variantes arbitraires inline (`[@media(pointer:coarse)]:…`) marche mais dépend de l'ordre de
   sortie de Tailwind pour battre `lg:` : fragile, écarté volontairement.
2. **`tailwind.config.js` — palier `display-sm` manquant.** J'ai remplacé les classes mortes de
   `admin.html` par des classes existantes. Si le design veut vraiment un palier intermédiaire
   (~24–28 px) entre `headline-md` (20 px) et `display-lg` (32 px), il faut l'ajouter à
   `theme.extend.fontSize` **et** à `theme.extend.fontFamily`.
3. **`tailwind.config.js` — pas de breakpoint tablette dédié.** Tout a été fait avec l'échelle par
   défaut (`sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280), qui suffit. Un palier `tablet: '820px'`
   affinerait l'iPad Air mais nécessite la config.
4. **Bordures de boutons en `outline-variant` (1.71:1).** La consigne limitait le passage à
   `border-outline` aux contrôles de saisie ; les boutons fantômes (`BTN_GHOST`, boutons d'action
   de l'admin) gardent donc une bordure à 1.71:1. Défendable au regard de 1.4.11 (le libellé
   textuel identifie le composant, la bordure n'est pas indispensable), mais si le propriétaire
   veut les couvrir aussi, le bon geste est d'assombrir le **token** `outline-variant` dans
   `tailwind.config.js` plutôt que de disperser des classes — hors périmètre.
5. **`app.html` n'a pas de `<footer id="site-footer">`.** C'est volontaire (studio pleine hauteur,
   `lg:h-screen lg:overflow-hidden`) et `mountChrome()` gère l'absence. Laissé tel quel.
6. **`login.html` / `register.html` / `verify.html` n'ont pas de `#site-header`.** Pages
   d'authentification autonomes avec leur propre chrome. Intentionnel, laissé tel quel.
7. **Garde-fou du token `outline` non testé en conditions réelles.** Le commentaire de
   `tailwind.config.js` note que `#646674` retombe à ~4.3 sur `surface-container-highest`,
   `surface-variant` (`#e2e2e2`) et `error-container` (`#ffdad6`). Aucune de ces paires n'existe
   aujourd'hui (axe le confirme : 0 violation), mais les `text-outline` ajoutés ou déplacés ici
   sont tous sur fond blanc ou `background`.
8. **Polices réelles non testées.** Pas de réseau dans le bac à sable : mesures faites avec DejaVu
   Sans (plus large qu'Inter) et un carré de 1 em à la place des glyphes Material Symbols. Les
   marges constatées sont donc des minorants. Une passe visuelle avec les vraies polices reste
   souhaitable avant mise en ligne.

## 6. Fichiers modifiés

`admin.html`, `app.html`, `history.html`, `index.html`, `legal.html`, `login.html`,
`register.html`, `tarifs.html`, `verify.html`,
`js/admin.js`, `js/app.js`, `js/auth.js`, `js/components.js`, `js/nav.js`, `js/tarifs.js`,
`js/verify.js`, plus `css/app.css` (généré — à recompiler en fin de chaîne avec
`cd frontend && npx tailwindcss -i ./css/input.css -o ./css/app.css`).
