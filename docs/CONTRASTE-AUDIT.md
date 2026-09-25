# Audit de contraste couleur — WCAG 2.2 AA

Objectif : tout texte ≥ 4.5:1 (3:1 toléré pour le texte large, ≥ 24 px ou ≥ 18.66 px en gras).
Cible secondaire examinée : 1.4.11 (contraste non textuel, 3:1) sur les bordures de champs et
les indicateurs de focus.

**Résultat : 936 → 36 nœuds en violation `color-contrast` (−96 %), 21 → 3 signatures distinctes.**
Les 3 restantes proviennent toutes du même wrapper `opacity-60` de la toile vide du studio, non
corrigeable depuis `tailwind.config.js` (voir § *Corrections hors périmètre*).

---

## 1. Méthode

Audit sur pages **réellement rendues**, pas sur du grep : le contraste effectif dépend de
l'empilement des fonds (une carte `surface-container-lowest` dans une section `background`, un
panneau `surface-container` derrière une légende `text-outline`).

| Étape | Détail |
|---|---|
| Build | `npm install` + remplacement du stub `@tailwindcss/forms` par le vrai paquet 0.5.9, puis `npx tailwindcss -i ./css/input.css -o ./css/app.css` |
| Serveur | `/tmp/claude-0/harness/server.js` — sert `frontend/` en statique et stube `/api/*` (`auth/me` connecté **et** 401 anonyme, `auth/config`, `billing/plans` en mode `stripe` avec les 4 formules reprises de `publicPlans()`, `billing/subscription`, `usage`, `history`, `admin/*`). Sans ces stubs, `mountChrome()` laisse header et pied de page vides et l'audit porte sur une page tronquée. Un `POST /__state` bascule les scénarios. |
| Moteur | Playwright 1.56 + Chromium `/opt/pw-browsers/chromium`, axe-core 4.x injecté par `page.addScriptTag`, `axe.run(document, {runOnly:['color-contrast','color-contrast-enhanced']})` |
| Viewports | **1280×900** et **390×844**, menu mobile de `nav.js` déplié à chaque passe 390 px (vérifié : 6 à 9 liens/boutons visibles par page) |
| États hover/focus | Deuxième passe axe avec `CSS.forcePseudoState` (CDP) sur `a, button, summary, input, select, textarea, label, .group, .js-card, details` — les variantes `hover:` / `focus:` et les révélations `group-hover:` sont donc dans le lot |
| Vérifications manuelles | Relevé DOM indépendant d'axe : fonds effectifs derrière chaque `text-outline`, contraste des bordures de contrôles, couleurs d'anneau de focus (`probe.js`, `verify.js`, `states.js`) |
| Mesure au pixel | `grain.js` — capture Playwright + moyenne des pixels (`sharp`) pour tenir compte du calque de grain de `css/input.css`, invisible pour axe (§ 2 bis) |

**24 scénarios × 2 viewports × 2 passes (repos + hover/focus) = 96 passes axe.**

Pages : `index`, `tarifs`, `legal`, `login`, `register`, `app`, `history`, `admin`, `verify`.
États dynamiques couverts et **vérifiés présents au rendu** (pas seulement demandés) :

| État | Preuve mesurée |
|---|---|
| `/tarifs.html?bienvenue=1` | notice `bg-surface-container-low` / `text-on-surface-variant` → 8.48:1 |
| `/tarifs.html?checkout=cancel` | idem notice `ok` |
| `/tarifs.html?demo=souscrit` (mode démo) | idem |
| Abonnement actif (`pro`, 64/100, 20 crédits, résiliation programmée) | bloc `#current` rendu |
| `past_due` | mention « (paiement en attente) » en `text-error` |
| Erreur `notice('err', …)` | clic `.js-subscribe` → 402 → `bg-error-container` + `text-on-error-container` → **7.24:1** |
| Facturation désactivée (404) | notice d'erreur sur `#plans` |
| Adresse non confirmée | `#verify-banner` `bg-error-container` → **7.24:1** |
| Modale CGU (`termsOutdated`) | `#terms-modal` → 9.35:1 |
| Historique : échecs dépliés, vignettes cassées (`brokenThumb`) | rendus |
| Survol des cartes d'historique (dégradé `rgba(26,28,28,.55)`) | boutons à fond blanc opaque → 17.12:1 |
| `verify.html` : succès / lien expiré / sans jeton | rendus |
| Bandeaux `#error` masqués par défaut (`admin`, `login`, `register`) | révélés à la main et mesurés (14.98 / 6.13 / 6.13) |

---

## 2. Token modifié

**Un seul token, un seul fichier : `frontend/tailwind.config.js`.**

| Token | Avant | Après | Delta |
|---|---|---|---|
| `outline` | `#747686` | `#646674` | teinte et saturation conservées (HSL 233.3°/7.2 % → 232.5°/7.4 %), luminosité 49.0 % → 42.4 % |

Le token ne sert **que** de couleur de texte — vérifié au grep strict : 42 `text-outline`,
12 `placeholder:text-outline`, **zéro** `bg-outline`, **zéro** `border-outline`. L'assombrir ne se
propage donc à aucun fond ni aucune bordure. (Les 103 `border-outline-variant` relèvent d'un
token distinct, laissé intact — voir § 5.)

### Ratios, mesurés sur les fonds réels

| Fond | Token de fond | Avant `#747686` | Après `#646674` (CSS) | Après, **pixels rendus** (grain compris) |
|---|---|---:|---:|---:|
| `#ffffff` | `surface-container-lowest` | 4.49 ❌ | **5.68** ✅ | **5.61** ✅ |
| `#f9f9f8` | `background` / `surface` | 4.26 ❌ | **5.40** ✅ | **5.32** ✅ |
| `#f3f4f3` | `surface-container-low` | 4.07 ❌ | **5.15** ✅ | **5.40** ✅ |
| `#eeeeed` | `surface-container` | 3.87 ❌ | **4.90** ✅ | **4.82** ✅ |
| `#e8e8e7` | `surface-container-high` | 3.66 ❌ | 4.64 ✅ | 4.54 ✅ |
| `#e2e2e2` | `surface-container-highest` / `surface-variant` | 3.47 ❌ | 4.39 ⚠ | 4.29 ⚠ |
| `#ffdad6` | `error-container` | 3.47 ❌ | 4.40 ⚠ | 4.31 ⚠ |

Les quatre premiers fonds sont les seuls où `text-outline` apparaît réellement — relevé DOM
exhaustif sur les 13 pages/états (`probe.js`), pas une déduction de CSS. Le pire fond réel est
`#eeeeed` : le panneau gauche de `login.html` (`bg-surface-container`, visible à partir de `lg`)
porte les légendes « PHOTO BRUTE », l'icône `arrow_forward` et le « © 2026 AdCraft ».

`#646674` reste un gris discret (intention visuelle conservée : ni noir, ni gris neutre — la teinte
bleutée est intacte) et laisse ~0.3 point de marge sur le pire fond réel une fois le grain appliqué.
Une valeur encore plus claire est mathématiquement possible (`#666876` sort à 4.69 rendu sur
`#eeeeed`), mais elle placerait le token à 0.19 du seuil alors que `css/input.css` porte un calque
de grain dont l'opacité est encore en cours d'arbitrage — voir § 2 bis.

**⚠ Garde-fou documenté dans le fichier** : les deux dernières lignes du tableau restent sous 4.5.
Ces paires n'existent nulle part aujourd'hui. Poser un `text-outline` sur
`surface-container-highest`/`surface-variant` ou sur `error-container` exigerait de réassombrir le
token (`#5f6170` couvre les sept fonds, à 4.66 rendu minimum).

---

## 2 bis. Interaction avec le calque de grain de `css/input.css`

Pendant cet audit, un autre chantier a ajouté à `css/input.css` un **calque de grain plein écran**
(`body::before`, `opacity: .12`, `mix-blend-mode: multiply`, `z-index: 1`, `position: fixed`). Il se
pose **au-dessus du texte comme du fond** — tout ce qui est en flux normal sans `z-index` passe
dessous.

**axe-core ne le voit pas** : il lit les couleurs CSS calculées, pas les pixels. Toutes les mesures
de ce rapport ont donc été **doublées au pixel** (`grain.js` : pastilles de couleur pleine injectées
dans le flux, capture Playwright, moyenne des pixels via `sharp`).

Effet mesuré : un facteur multiplicatif ≈ **0.984–0.987** sur les couleurs claires et moyennes,
≈ 1.000 sur les couleurs déjà très sombres (`on-surface` `#1a1c1c`, `primary` `#0037b0`). Comme les
deux plans s'assombrissent ensemble, le coût net sur le ratio est faible mais **systématiquement
négatif** :

| Paire | CSS | Pixels rendus | Coût |
|---|---:|---:|---:|
| `outline` `#646674` / `#eeeeed` | 4.90 | **4.82** | −0.08 |
| `secondary` / `#ffffff` | 6.49 | 6.40 | −0.09 |
| `on-surface-variant` / `#ffffff` | 9.35 | 9.18 | −0.17 |
| `on-surface` / `#ffffff` | 17.12 | 16.55 | −0.57 |
| `error` / `#ffffff` | 6.46 | 6.39 | −0.07 |
| `on-error-container` / `#ffdad6` | 7.24 | 7.12 | −0.12 |
| `on-primary` / `primary-container` `#1d4ed8` | 6.70 | 6.62 | −0.08 |
| `on-primary` / `primary` `#0037b0` (survol) | 9.66 | 9.49 | −0.17 |

**Les 15 paires réellement employées passent AA avec le grain.** Le coût est quasi insensible à
l'opacité du calque (`outline`/`#eeeeed` : 4.86 à 10 %, 4.84 à 15 %, 4.82 à 20 %), donc un
réglage ultérieur de la texture ne remettra pas la conformité en cause.

C'est cette mesure qui a fixé la valeur finale du token : un premier candidat `#686a78` (le plus
clair possible d'après le seul CSS, 4.61 sur `#eeeeed`) retombait à **4.56** au pixel — conforme
mais à 0.06 du seuil, trop juste pour un calque encore susceptible d'évoluer. `#646674` sort à 4.82.

---

## 3. Tableau avant / après, par violation

Ratios relevés par axe-core au rendu, donc **d'après le CSS calculé**. `n` = nombre de nœuds sur
l'ensemble des 96 passes. Le calque de grain retire ~0.08 point à chaque valeur de la colonne
« Après » (4.82 au pixel pour les 4.90, 5.08 pour les 5.15, 5.32 pour les 5.40, 5.61 pour les
5.68) : toutes restent ≥ 4.5 — détail au § 2 bis. Les lignes 19 à 21 s'en trouvent aggravées, pas
sauvées (« Toile de création » tombe de 4.49 à ~4.46).

| # | Page(s) | Sélecteur / exemple | Texte | Couleurs | Taille | Avant | Après | n |
|---|---|---|---|---|---|---:|---:|---:|
| 1 | login (≥ lg) | `figcaption.text-outline`, `.py-lg > .text-outline` | « PHOTO BRUTE », « © 2026 AdCraft » | `#747686` / `#eeeeed` | 11 px / 600 | **3.87** ❌ | **4.90** ✅ | 4 |
| 2 | login (≥ lg) | `.material-symbols-outlined.text-outline` | icône `arrow_forward` | `#747686` / `#eeeeed` | 22 px | **3.87** ❌ | **4.90** ✅ | 2 |
| 3 | history (survol du `<summary>`) | `.js-failures summary .text-outline` | icônes `error_outline`, `expand_more` | `#747686` / `#eeeeed` | 15–16 px | **3.87** ❌ | **4.90** ✅ | 14 |
| 4 | login | `.text-[18px].text-outline` | icône `person_add` | `#747686` / `#f3f4f3` | 18 px | **4.07** ❌ | **5.15** ✅ | 4 |
| 5 | history | `.js-failures .text-outline` | `error_outline`, `expand_more` | `#747686` / `#f3f4f3` | 15–16 px | **4.07** ❌ | **5.15** ✅ | 10 |
| 6 | 22 pages/états | `.py-lg > .text-outline` (`renderFooter`, `js/nav.js:106`) | « © 2026 AdCraft » | `#747686` / `#f9f9f8` | 11 px | **4.26** ❌ | **5.40** ✅ | 168 |
| 7 | index | `figcaption.text-outline` | « PHOTO BRUTE » / « RÉSULTAT » (hero) | `#747686` / `#f9f9f8` | 11 px / 600 | **4.26** ❌ | **5.40** ✅ | (inclus ci-dessus) |
| 8 | register | `p.font-body-sm.text-outline` | « Vous démarrez sur la formule gratuite… » | `#747686` / `#f9f9f8` | 13 px | **4.26** ❌ | **5.40** ✅ | 4 |
| 9 | register | `li[data-rule] .text-outline` | `radio_button_unchecked` (règles de mot de passe) | `#747686` / `#f9f9f8` | 15 px | **4.26** ❌ | **5.40** ✅ | 12 |
| 10 | app | `#dropzone .text-outline` | icône `add` + « Ajouter » | `#747686` / `#f9f9f8` | 18 px / 11 px | **4.26** ❌ | **5.40** ✅ | 24 |
| 11 | index, tarifs, app | `span.text-outline` | « Sept thèmes… », « sans carte bancaire », « soit 0,33 € par visuel » | `#747686` / `#ffffff` | 11 px | **4.49** ❌ | **5.68** ✅ | 186 |
| 12 | index | `.text-outline.text-[22px]` | `arrow_forward` (comparatif avant/après) | `#747686` / `#ffffff` | 22 px | **4.49** ❌ | **5.68** ✅ | 8 |
| 13 | 18 pages/états | `#cookie-banner .text-outline` (`js/nav.js:133`) | icône `cookie` | `#747686` / `#ffffff` | 20 px | **4.49** ❌ | **5.68** ✅ | 72 |
| 14 | tarifs | `li .text-[16px].text-outline` (`js/tarifs.js:71`) | puces `check` des formules | `#747686` / `#ffffff` | 16 px | **4.49** ❌ | **5.68** ✅ | 320 |
| 15 | app, history | `span.text-outline`, `#reset` | « (optionnel) », bouton « Réinitialiser » | `#747686` / `#ffffff` | 12 px / 600 | **4.49** ❌ | **5.68** ✅ | 48 |
| 16 | app | `p.font-body-sm.text-outline` | aides de champ (« À renseigner si l'IA se trompe… ») | `#747686` / `#ffffff` | 13 px | **4.49** ❌ | **5.68** ✅ | 24 |
| 17 | history | `.material-symbols-outlined.text-outline` | icône `search` du filtre marque | `#747686` / `#ffffff` | 18 px | **4.49** ❌ | **5.68** ✅ | 12 |
| 18 | history | `span[title]` (`successCard`, `js/components.js:149`) | dates relatives « Il y a 2 h » | `#747686` / `#ffffff` | 11 px | **4.49** ❌ | **5.68** ✅ | (inclus l. 11) |
| **19** | **app** | `.opacity-60 .text-outline-variant` (`app.html:151`, `js/app.js:289`) | icône `auto_awesome` de la toile vide | `#dcdce7` / `#ffffff` | 48 px (3:1) | **1.36** ❌ | **1.36** ❌ | 12 |
| **20** | **app** | `.opacity-60 .text-secondary` (`app.html:154`, `js/app.js:292`) | « Configurez vos paramètres puis cliquez sur « Générer »… » | `#a19e9d` / `#ffffff` | 13 px | **2.66** ❌ | **2.66** ❌ | 12 |
| **21** | **app** | `.opacity-60 .text-on-surface` (`app.html:153`, `js/app.js:291`) | « Toile de création » | `#767777` / `#ffffff` | 20 px | **4.49** ❌ | **4.49** ❌ | 12 |

Lignes 19 à 21 : **hors périmètre** (`app.html` / `js/app.js`), détail au § 6.

### Par scénario

| Scénario | Avant | Après |
|---|---:|---:|
| index-anon / index-connecte | 24 / 24 | 0 / 0 |
| tarifs-anon, -free, -bienvenue, -checkout-cancel, -abo-actif, -past-due, -mode-demo, -erreur | 64 chacun | 0 |
| tarifs-billing-off | 8 | 0 |
| legal | 8 | 0 |
| login | 10 | 0 |
| register | 20 | 0 |
| app-studio / app-non-verifie / app-cgu-modale | 60 chacun | **12** chacun |
| history / -echecs-ouverts / -vignettes-ko | 46 chacun | 0 |
| admin | 0 | 0 |
| verify-ok / -expire / -sans-token | 4 chacun | 0 |
| **TOTAL** | **936** | **36** |

---

## 4. Faux positifs et cas hors critère, justifiés

### 4.1 Nœuds `incomplete` d'axe — tous repris à la main, tous conformes

axe classe 435 nœuds en *incomplete* (il refuse de trancher). Chacun a été remesuré par empilement
réel des fonds et des opacités (`verify.js`) :

| Motif axe | Exemple | fg / bg réels | Ratio réel | Verdict |
|---|---|---|---:|---|
| « background color could not be determined due to a background image » | `<select>` — le plugin `@tailwindcss/forms` pose le chevron en `background-image` SVG, aligné à droite, hors du flux du texte | `#1a1c1c` / `#ffffff` | **17.12** | faux positif |
| idem, `admin.html` | `#gen-status` sur `bg-surface` | `#1a1c1c` / `#f9f9f8` | **16.25** | faux positif |
| idem, `history.html` | `#f-category`, `#f-theme`, `#f-sort` | `#434655` / `#ffffff` | **9.35** | faux positif |
| « partially overlaps other elements » | `#cookie-banner p` — la bannière `fixed` chevauche le contenu sous-jacent, son propre fond est pourtant opaque (`bg-surface-container-lowest`) | `#434655` / `#ffffff` | **9.35** | faux positif |
| idem | icônes `logout` / `close` du header sur pastille `bg-surface-container` | `#434655` / `#eeeeed` | **8.05** | faux positif |
| idem | `<th>` / `<td>` des tableaux `admin.html` | `#625d5b` / `#ffffff`, `#1a1c1c` / `#ffffff` | **6.49** / **17.12** | faux positif |
| idem | boutons d'action admin en `text-error` | `#ba1a1a` / `#ffffff` | **6.46** | faux positif |
| « content is too short to determine if it is actual text content » | cellules numériques d'`admin.html` (`0`, `3`, `350`) | `#1a1c1c` / `#ffffff` | **17.12** | faux positif |

Aucun *incomplete* ne masque une vraie violation : le plus faible mesuré est 6.46:1.

### 4.2 Texte sur dégradé — survol des cartes d'historique

`js/components.js:134` superpose `linear-gradient(to top, rgba(26,28,28,.55), rgba(26,28,28,0))`
sur la vignette. Les deux commandes révélées (télécharger, supprimer) ont un fond **opaque**
`bg-surface-container-lowest` ; le dégradé ne passe jamais derrière leur glyphe. Mesuré avec le
survol forcé : `#1a1c1c` sur `#ffffff` = **17.12:1**. Rien à corriger.

### 4.3 Contrôles désactivés — exemptés par 1.4.3

`js/tarifs.js:13-14` : `disabled:opacity-60` sur `BTN_PRIMARY` / `BTN_GHOST`. Mesuré sur le bouton
« Inclus par défaut » : `#8e9099` sur `#ffffff` = **3.18:1**, sous 4.5. WCAG 1.4.3 exclut
explicitement « le texte d'un composant d'interface inactif » ; axe-core applique la même règle et
ne les signale pas. **Aucune correction** — sur-corriger effacerait le signal visuel du désactivé.
Mêmes boutons à l'état actif : `text-on-primary` `#ffffff` sur `bg-primary-container` `#1d4ed8` =
6.70, et au survol sur `bg-primary` `#0037b0` = **9.66**. Les deux états passent.

### 4.4 Placeholders — conformes, contrairement à l'hypothèse de départ

Deux règles se superposent. Le *preflight* Tailwind écrit `::placeholder { color: #9ca3af }`
(gray-400, 2.54:1) — mais `@tailwindcss/forms` le **surcharge ensuite** par `#6b7280` (gray-500),
soit 4.83 sur `#ffffff` et **4.59** sur `#f9f9f8` (4.79 / **4.55** au pixel, grain compris).
Conforme. Le stub `module.exports=()=>{}` trouvé dans `node_modules` masquait cette surcharge :
c'est en installant le vrai paquet que le point est tranché.

Sur les onze champs porteurs d'un attribut `placeholder=`, **dix** utilisent
`placeholder:text-outline` et passent donc à 5.68:1. Le seul à retomber sur le défaut du plugin est
`admin.html:47` (recherche par e-mail, sur `bg-surface`) : 4.55 au pixel, conforme.
**Aucune correction**, et surtout pas d'override de `colors.gray.400` : il ne serait ni nécessaire
ni effectif, le plugin gagnant dans la cascade.

### 4.5 Indicateurs d'état non textuels — conformes

- `shadow-[inset_0_-2px_0_#1d4ed8]` (`js/nav.js:13`, soulignement de l'onglet actif) :
  `#1d4ed8` sur `#ffffff` = **6.70:1**, très au-dessus des 3:1 de 1.4.11. L'état actif est de plus
  redondé par `aria-current="page"` et par le passage `text-secondary` → `text-on-surface`.
- Anneaux de focus, mesurés avec `:focus` forcé par CDP : tous les champs passent en
  `border-primary-container` + `ring-1 primary-container` → `#1d4ed8` sur `#ffffff` = **6.70**,
  sur `#f9f9f8` = **6.36**. `admin.html` (pas de `focus:` explicite) hérite du défaut du plugin
  `#2563eb` = **5.17**. Liens et boutons sans `focus:` gardent l'`outline` du navigateur
  (16 à 21:1). Conformes.

### 4.6 `outline-variant` `#c4c5d7` — séparateurs décoratifs, volontairement non touché

1.71:1 sur blanc. Sur 103 usages, l'écrasante majorité sont des **séparateurs et contours de carte
décoratifs** (`h-px bg-outline-variant`, bordures de `<article>`, `border-t` de lignes de liste) :
1.4.11 ne s'y applique pas, et les assombrir dénaturerait tout le design system. Token conservé.
Le cas des **bordures de champs de saisie**, lui, relève bien de 1.4.11 — mais il partage le même
token que le décoratif : impossible de trancher depuis `tailwind.config.js`. Voir § 6, point 3.
Les deux `text-outline-variant` restants (`app.html:151`, `js/app.js:289`) sont l'icône décorative
de la toile vide, traitée au § 6 point 1.

---

## 5. Ce qui passait déjà et n'a pas bougé

Ratios CSS, puis au pixel (grain compris) : `secondary` 6.49 → 6.40 · `on-surface-variant`
9.35 → 9.18 · `on-surface` 17.12 → 16.55 · `error` 6.46 → 6.39 sur blanc et 6.13 → 6.07 sur
`#f9f9f8` · `on-error-container` sur `error-container` 7.24 → 7.12 · `on-primary` sur
`primary-container` 6.70 → 6.62 et sur `primary` (survol) 9.66 → 9.49 · `text-on-surface` sur
`bg-error-container/40` (bandeau d'erreur admin) 14.98. Toutes conformes dans les deux colonnes.

---

## 6. Corrections NON faites — hors de `tailwind.config.js`

À appliquer par l'orchestrateur. Les trois premières sont les **seules violations `color-contrast`
qui subsistent** ; les suivantes relèvent de 1.4.11 / 2.4.7 et ont été trouvées en chemin.

### 1. `opacity-60` sur la toile vide du studio — **bloquant, 3 violations × 6 passes**

Un même wrapper, dupliqué en deux endroits, éteint trois textes d'un coup :

- **`frontend/app.html`, ligne 150** : `<div class="flex flex-col items-center gap-md opacity-60">`
- **`frontend/js/app.js`, ligne 288** (`showEmpty()`) : même balise, même classe

| Enfant | Couleur nominale | Composite à 60 % sur `#ffffff` | Ratio | Exigé |
|---|---|---|---:|---:|
| `text-outline-variant` (icône `auto_awesome`, 48 px) | `#c4c5d7` | `#dcdce7` | 1.36 | 3:1 |
| `text-on-surface` (« Toile de création », 20 px) | `#1a1c1c` | `#767777` | 4.49 | 4.5:1 |
| `text-secondary` (phrase d'aide, 13 px) | `#625d5b` | `#a19e9d` | 2.66 | 4.5:1 |

**Correction proposée : supprimer `opacity-60`** des deux blocs (les couleurs nominales donnent
alors 1.71 / 17.12 / 6.49 — l'icône décorative reste hors critère, cf. ci-dessous). Si l'effet
« atténué » doit être conservé, le porter sur la seule icône (`opacity-60` sur le `<span>`
`auto_awesome`) et laisser les deux textes à pleine opacité.

Pourquoi ce n'est pas corrigeable au niveau token : ramener `secondary` à 4.5:1 **après** une
opacité de 60 % imposerait un `#171717`, ce qui détruirait un gris utilisé partout ; idem pour
`outline-variant`, qui devrait passer à `#4d4d59` et emporterait les 103 bordures du site.

*Note WCAG* : une fois l'opacité retirée, l'icône `auto_awesome` reste à 1.71:1
(`outline-variant` sur blanc). Elle relève de l'exception « pure décoration » de 1.4.3/1.4.11, mais
axe continuera de la signaler : les Material Symbols sont des ligatures, donc des nœuds texte, et
`aria-hidden="true"` n'y change rien — vérifié sur `index.html`, où l'`arrow_forward` déjà porteur
de `aria-hidden` était bel et bien remonté par axe. **Correction proposée : passer cette icône de
`text-outline-variant` à `text-outline`** (`#646674`, soit **5.68:1** en CSS et **5.61:1** au pixel, pour 3:1 requis à 48 px).
Elle reste un gris clair, et le rapport sort à zéro violation.

### 2. Focus invisible sur les tuiles de thème — 2.4.7

- **`frontend/js/components.js`, ligne 112** :
  `class="theme-btn flex flex-col gap-[5px] text-left focus:outline-none"`

`focus:outline-none` supprime l'anneau du navigateur **sans rien mettre à la place** (mesuré :
`outline: 2px solid transparent`). C'est le seul `focus:outline-none` du projet qui n'est pas
accompagné d'un `focus:ring-*` / `focus:border-*`.

**Correction proposée** : `focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-primary-container focus-visible:ring-offset-2` — soit 6.70:1 sur blanc.

### 3. Bordures de champs de saisie — 1.4.11 (3:1)

`border-outline-variant` `#c4c5d7` donne **1.71** sur `#ffffff`, **1.62** sur `#f9f9f8`, **1.55**
sur `#f3f4f3`. Pour un champ à fond blanc sur une page blanche, ce trait est la **seule**
information qui délimite la zone de saisie : 1.4.11 s'applique.

**Correction proposée : remplacer `border-outline-variant` par `border-outline` sur les seuls
contrôles de saisie** — le token `outline` vaut maintenant `#646674`, soit **5.68:1** sur blanc et
**5.40** sur `#f9f9f8`. Aucun nouveau token n'est nécessaire, et les séparateurs décoratifs gardent
`outline-variant`. (L'utilitaire `border-outline` n'est pas encore émis par le JIT : il apparaîtra
au premier `npm run build:css` suivant la modification.)

| Fichier | Lignes | Élément |
|---|---|---|
| `frontend/app.html` | 61, 68, 84, 91, 101, 129 | `#brand`, `#category`, `#flavor`, `#product-count`, `#description`, `#art-direction` |
| `frontend/history.html` | 43, 46, 49, 52 | `#f-brand`, `#f-category`, `#f-theme`, `#f-sort` |
| `frontend/login.html` | 84, 91 | `#email`, `#password` |
| `frontend/register.html` | 44, 49, 55, 66, 70 | nom, `#email`, mots de passe, `#terms` (case à cocher) |
| `frontend/admin.html` | 48, 57 | `#search`, `#gen-status` |
| `frontend/js/nav.js` | 199 | `#terms-check` de la modale CGU |

### 4. Bordure du bouton « Renvoyer l'e-mail » — 1.4.11, priorité basse

- **`frontend/js/nav.js`, ligne 164** : `border border-on-error-container/40`

`rgba(147,0,10,.4)` composité sur `bg-error-container` `#ffdad6` donne `#d48384`, soit **2.21:1** ;
le fond blanc du bouton sur ce même rose vaut 1.22:1. Le contour du bouton est donc à peine
perceptible dans le bandeau.

**Correction proposée** : retirer le `/40` → `border-on-error-container` = `#93000a` sur `#ffdad6`
= **7.24:1**. Le libellé du bouton, lui, est déjà à 9.35:1.

### 5. Hors contraste, relevé pendant l'audit

- **`frontend/js/admin.js`** n'appelle jamais `mountChrome()` alors que `admin.html:18` déclare
  `<header id="site-header" data-page="admin">` et un `<footer id="site-footer">` : sur cette page
  seule, l'en-tête et le pied restent **vides**. Ajouter `await mountChrome({ requireAuth: true })`
  dans l'IIFE finale (en remplacement de `requireUser()`).
- **`admin.html`** utilise `font-display-sm` / `text-display-sm` (lignes 34, 38, 46, 56 et `js/admin.js:40`), **absents** de `theme.extend.fontSize` : ces titres retombent sur la taille
  héritée. Sans impact de contraste (le texte est en `on-surface`), mais la hiérarchie typographique
  est cassée. À trancher hors de cet audit : soit ajouter le palier, soit basculer sur
  `font-headline-md` / `text-headline-md`.

---

## 7. Rejouer l'audit

```bash
cd /home/claude/work/ad-generator/frontend
npm install
npx tailwindcss -i ./css/input.css -o ./css/app.css     # ou: npm run build:css (minifié)

cd /tmp/claude-0/harness
node server.js &                                        # stub API + statique, :4321
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node audit.js  /tmp/claude-0/harness/after.json
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node verify.js # incomplete + focus + menu mobile
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node probe.js  # fonds effectifs + non textuel
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node states.js # présence des états dynamiques
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node grain.js  # ratios au pixel, calque de grain inclus
```

`css/app.css` a été régénéré **non minifié** pour l'audit. Il doit être reconstruit avec
`npm run build:css` une fois `css/input.css` stabilisé (un autre chantier était en cours dessus).
