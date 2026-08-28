# Champ description + refonte des prompts de thème

Deux chantiers liés : ajouter une description libre du produit, et restructurer les prompts pour que la description ait un emplacement propre. Le premier sans le second ne sert à rien.

---

## Partie A — Champ « description » (Claude Code)

### Base

Migration additive, `backend/src/db.js` :

```sql
ALTER TABLE generations ADD COLUMN description TEXT;
```

Écris-la de façon idempotente (vérifie `PRAGMA table_info(generations)` avant), pour que le démarrage ne casse pas sur une base déjà migrée.

### Backend

`POST /api/generate` accepte `description`. Contraintes :

- optionnel, chaîne, **120 caractères maximum**, tronqué au-delà plutôt que rejeté ;
- nettoyé avant transmission : retire les sauts de ligne et les caractères de contrôle. Ce texte part dans un prompt d'image — une consigne glissée dedans (« ignore les instructions précédentes ») ne doit pas pouvoir détourner le rendu. Le nettoyage ne suffit pas à lui seul : c'est la structure du prompt (partie B) qui contient le risque, en cantonnant la description à un emplacement descriptif.

La description est transmise à n8n dans le corps existant, à côté de `brand`, `category`, `flavor`, `theme`, `images`, et stockée en base avec la génération.

### Front

Champ texte sous « Goût / variante », libellé **Description du produit** avec la mention `(optionnel)`, placeholder `Ex : croissant fourré au Nutella`, compteur de caractères discret à droite quand on dépasse 90.

Une ligne d'aide sous le champ : « Précisez la forme réelle du produit si la catégorie ne suffit pas — canette, sachet, pot, coffret… ». C'est exactement le cas d'usage : « Monster · boisson » ne dit pas s'il s'agit d'une canette d'énergisant ou d'un café en bouteille.

Affiche la description sur la carte d'historique, en une ligne tronquée sous le nom du produit.

---

## Partie B — Structure des prompts (node « Build Prompt » de n8n)

Le prompt actuel concatène tout dans une seule phrase, ce qui explique la variabilité entre deux rendus d'un même thème : rien ne fixe le cadrage ni la fidélité au packaging, et le décor déborde sur le produit.

Découpe le prompt en blocs, dont un seul change selon le thème.

### Squelette commun, identique pour les sept thèmes

```
Professional advertising photograph of {brand}{description ? " — " + description : ""}{flavor ? ", " + flavor + " variant" : ""}.

PRODUCT FIDELITY (highest priority): reproduce the product packaging exactly as shown in
the reference images — label artwork, logo, typography, colours and proportions unchanged.
Do not redraw, translate or reinterpret any text printed on the packaging. Add no text,
no caption, no watermark, no logo other than those already on the product.

FRAMING: {theme.framing}
SCENE: {theme.scene}
LIGHT: {theme.light}
MOOD: {theme.mood}

TECHNICAL: photorealistic commercial product photography, 4:5 vertical, product centred and
occupying about 60% of frame height, shallow depth of field, no human hands or faces,
no other branded object in frame, no visible text outside the product packaging.
```

La description prend place dans la **première ligne seulement**, celle qui identifie le sujet. Elle ne touche ni aux contraintes de fidélité, ni au décor.

### Les sept blocs de thème

**Classique** — framing : eye-level, straight-on, product on a clean seamless surface. scene : neutral studio backdrop, subtle gradient, minimal props, soft reflection under the product. light : large softbox from front-left, gentle fill, no harsh shadow. mood : clean, neutral, catalogue-grade.

**Été** — framing : slightly low angle, product standing on sand or wet stone. scene : bright outdoor beach or poolside, turquoise water and palm shadows in the background, water droplets on the packaging, ice cubes if the product is a drink. light : hard midday sunlight, warm, strong specular highlights. mood : fresh, vivid, holiday.

**Extravagant** — framing : dynamic three-quarter angle, product slightly off-centre. scene : abstract studio set with bold geometric shapes, saturated colour blocking, floating ingredients or splashes frozen mid-air. light : coloured gels, strong rim light, high contrast. mood : bold, editorial, attention-grabbing.

**Sport** — framing : low angle, heroic, product slightly tilted forward. scene : gym floor, athletic track or urban concrete, motion blur in the background, chalk dust or water spray. light : hard directional light, deep shadows, cool tones. mood : energetic, powerful, dynamic.

**Nuit / Fête** — framing : eye-level, product on a bar counter or reflective black surface. scene : dark club or rooftop at night, bokeh city lights or neon signs far behind, condensation on the packaging. light : blue and magenta neon rim light, warm key light on the product. mood : festive, nocturnal, premium.

**Luxe** — framing : centred, slightly above eye-level, product on a marble or dark stone pedestal. scene : minimal dark set, silk or velvet texture, single elegant prop at most. light : single soft key light, deep falloff, subtle golden highlights. mood : refined, restrained, expensive.

**Noël / Hiver** — framing : eye-level, product among winter props at its base. scene : wooden table, pine branches, warm string lights bokeh, light snow or frost on the surface. light : warm tungsten key, cool blue fill from a window. mood : cosy, festive, seasonal.

### Négatifs

Nano Banana répond mieux à des interdits explicites qu'à des formulations positives seules. Ajoute en fin de prompt :

```
AVOID: altered or invented packaging text, distorted logo, extra products, hands, faces,
watermarks, added slogans, cartoon or illustration style, visible AI artefacts.
```

### Versionner les prompts

Sors les sept blocs du node n8n vers `n8n/prompts/` dans le dépôt, un fichier par thème, et fais lire le node depuis là — ou, à défaut, garde une copie versionnée synchronisée à la main. Sans ça, aucun diff n'est possible entre deux campagnes de test, et tu ne sauras jamais quel changement a amélioré quoi.

---

## Partie C — Valider, pas supposer

Avant de toucher aux prompts, fais une campagne de référence avec les prompts actuels : 7 thèmes × 4 produits de morphologies différentes (canette, sachet souple comme le Nutella, pot, coffret) × 2 répétitions. Puis la même campagne après refonte, sur les mêmes photos sources.

Note pour chaque image : packaging conservé à l'identique (oui/non), logo lisible et non déformé (oui/non), texte parasite ajouté (oui/non), cohérence avec le thème (1-5), utilisable en l'état (oui/non).

Ce qui compte est la **variance intra-thème** : deux produits différents sous le même thème doivent produire des images de même facture. Si elles divergent, c'est que le bloc de thème délègue encore trop au modèle.

56 images par campagne, environ 2,20 € — le coût n'est pas un argument pour s'en passer.
