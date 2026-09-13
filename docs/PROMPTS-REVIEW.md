# Revue des prompts — thèmes, multi-produits, Directeur Artistique

_13 septembre 2026. Source unique : `shared/prompt.mjs` → `node tools/build-n8n.mjs` → `n8n/generateur-publicite.json`._

## Diagnostic

### Pourquoi « Sport » donnait un vestiaire blanc avec une haltère

Le preset statique `sport` (terrain, golden hour, athlètes flous) n'est **plus** ce qui tourne en prod : depuis la branche direction artistique, c'est le node **Directeur Artistique** (modèle texte) qui invente la scène, et le preset ne sert que de repli. Or son system prompt disait :

> « Respect the requested theme as a STYLE constraint applied to that environment, not as a replacement for it. […] Energy drinks belong where energy is spent. […] at most four props. […] Never include people. »

Donc : thème = simple « style », environnement = « là où l'énergie se dépense » = salle de sport, sans personne, avec ≤ 4 accessoires → vestiaire, haltère, gourde, produit posé. Le modèle a fait exactement ce qu'on lui demandait. Les trois exemples few-shot (grange, terrasse italienne, cuisine) enfonçaient le clou : tous calmes, aucun exemple de thème énergique.

**Correction structurelle** : le thème définit désormais le **monde** (arène, fête, matières…) et le produit choisit la variante dans ce monde. Chaque thème a un brief complet (intention, décors candidats, lumière, palette, énergie, caméra, accessoires, interdits) envoyé au DA. Les few-shot couvrent Sport, Nuit et Luxe. Les silhouettes floues sans visage sont autorisées pour Sport/Nuit.

### Pourquoi plusieurs images ≠ plusieurs produits

1. Le DA **ne voyait pas les photos** (texte seul) : il ne pouvait ni compter, ni décrire la forme (canette / sachet / pot), ni distinguer « 3 photos du même produit » de « 3 produits ».
2. Le prompt image disait « include every distinct product » — implicite. Les modèles image suivent bien mieux une énumération : « exactly 3 products: 1. … 2. … 3. … ».
3. Le `lead` était au singulier (« photograph of Red Bull energy drink »).

**Correction** : le DA reçoit les photos (Gemini texte est multimodal) et renvoie un **inventaire** `products[{name, form, colors}]` — dédoublonné (même packaging sous plusieurs angles = 1 produit, plusieurs produits sur une photo = N). Build Prompt énumère explicitement, met le lead au pluriel, impose « none missing, none duplicated, none invented » et un bloc `ARRANGEMENT` (étagement en profondeur, étiquettes face caméra). Le champ **« Nombre de produits distincts »** (optionnel, 1–6) du studio force le compte quand l'IA se trompe ; il prime sur l'inventaire.

## Critique thème par thème

| Thème | Avant (preset / DA) | Problème | Après |
|---|---|---|---|
| **Classique** | « glossy reflective surface, gradient backdrop in brand colors, softbox » ; côté DA, les exemples tiraient vers grange/cuisine | Deux définitions contradictoires (packshot podium vs. « environnement naturel ») ; le rendu dépendait du chemin (DA ou repli) | Une seule définition : **catalogue premium épuré** — fond uni dérivé du packaging, surface mate, softbox + rim, ≤ 2 accessoires liés au produit, jamais de ferme ni de cuisine |
| **Été** | Plage + sable + eau turquoise + glaçons + condensation | Biais boisson : chips sur sable mouillé, parfum avec glaçons = absurde ; cliché stock | 6 décors candidats (terrasse, piscine, serviette sur sable sec, pique-nique, rochers, rooftop) ; glace/condensation **uniquement** si boisson ; accessoires dérivés du produit |
| **Extravagant** | « explosive energy burst, liquid crowns, electric arcs, shattered ice, neon smoke, sparks » | Tout en même temps → chaos, packaging illisible, biais liquide | **Une** grande idée (set monumental miroirs/chrome, échelle surréaliste, lévitation dans un vide coloré, scène théâtrale) + **un seul** élément dynamique adapté au produit (couronne de liquide / miettes volantes / soie / étincelles) |
| **Sport** | Preset correct (piste, golden hour, athlètes flous) mais DA → vestiaire, haltère, gourde | Cf. diagnostic : thème traité comme style, pas de personnes, ≤ 4 props | 8 arènes candidates (piste sous projecteurs, terrain de basket, ring, trail, bord de bassin, skate park, touche de terrain sous pluie, mur d'escalade) ; énergie obligatoire (eau, poussière, craie, silhouettes floues) ; **interdits explicites** : vestiaire, banc, salle vide, haltère isolée, gourde déco, studio blanc |
| **Nuit** (`fete`) | Boîte de nuit générique, néons violets/bleus, lasers, comptoir mouillé | Label « Nuit » mais clé `fete` : ambiguïté ; un seul décor ; foule floue OK mais jamais précisée | **Célébration nocturne** : rooftop, comptoir de cocktails, table de house-party avec confettis, backstage/DJ, réveillon ; gels magenta/bleu/ambre ; foule = bokeh lointain sans visage ; confettis en l'air |
| **Luxe** | Piédestal en marbre noir, dorures, fumée, spot zénithal, noir & or | Le cliché « bijouterie » exact — que le system prompt du DA dénonçait lui-même | **Matières et retenue** : penthouse à l'heure bleue, boutique laiton/noyer, bar cuir, drapé velours, dalle de pierre ; palette **dérivée du packaging** (vert profond, bordeaux, ivoire…) — noir & or seulement si le packaging l'est ; **jamais** de piédestal ni de fumée |
| **Noël** | Table rustique + neige + sapin + boules rouges + guirlandes + cheminée | Tous les clichés empilés dans un cadre → fouillis, palette rouge/vert imposée | **Un seul registre** au choix (coin du feu / table de fête / rebord de fenêtre enneigé / branche de sapin extérieure / table d'emballage cadeaux) ; ≤ 3 accessoires du même registre ; palette packaging d'abord |

## Blocs communs

- **FIDELITY** : ajout de « scale, proportions and materials of the packaging stay real » (les modèles étirent les canettes pour remplir le 4:5).
- **AVOID** : ajout de « missing or duplicated reference products », « extra products not in the references », « recognizable people », « cluttered composition ».
- **Ordre** : `lead → PRODUCTS → SCENE → FIDELITY → AVOID`, séparés par des retours à la ligne (le modèle segmente mieux qu'avec une phrase de 900 caractères).
- **Température du DA** : 0,9 → 0,7 (moins de dérive, les briefs apportent déjà la variété).
- **Timeout DA** : 30 s → 45 s (les photos sont maintenant dans la requête).

## Ce qui reste à valider en réel

1. Une génération **Sport** avec Red Bull (le cas signalé) : attendu = arène, silhouettes floues, aucune haltère.
2. Une génération avec **2 photos = 2 produits** et une avec **1 photo contenant 3 produits** : `art_direction_source=auto`, `product_count` correct dans la ligne `generations` (colonne ajoutée) et dans la réponse n8n (`products`).
3. Si le DA renvoie souvent `fallback` → onglet Executions n8n : vérifier que `GEMINI_TEXT_MODEL` accepte les images (gemini-2.5-flash oui ; sinon `gemini-3.5-flash`).
4. Comparer 3.1-flash-image 2K vs 3-pro-image 2K sur le texte d'emballage (cf. `docs/MODELES.md`).
