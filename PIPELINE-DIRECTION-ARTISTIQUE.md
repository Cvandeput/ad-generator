# Passer du gabarit à la direction artistique

Objectif : retrouver — et dépasser — la qualité des prompts écrits à la main, où le décor était déduit du produit lui-même. Aujourd'hui le workflow applique un décor présélectionné par thème ; il ne peut pas inventer la grange et les pommes de terre derrière un paquet de chips.

---

## Le principe

Insérer un node de rédaction **avant** le node Vertex. Le workflow passe de :

```
Webhook → Build Prompt → Nano Banana (Vertex) → Extract Image → Respond
```

à :

```
Webhook → Directeur Artistique (Gemini texte) → Build Prompt → Nano Banana (Vertex) → Extract Image → Respond
```

Le directeur artistique reçoit marque, catégorie, description, goût et thème. Il renvoie un objet structuré décrivant une scène **spécifique à ce produit**. Build Prompt assemble ensuite ce brief avec les contraintes de fidélité au packaging, invariables.

Coût : quelques centaines de jetons de texte, de l'ordre du dixième de centime — négligeable face aux 3,9 centimes de l'image. Latence : deux à cinq secondes de plus sur les 30 à 120 existantes.

---

## Node « Directeur Artistique »

Requête HTTP vers `gemini-2.5-flash` (le modèle texte, pas le modèle image), même credential Google Service Account, endpoint :

```
https://aiplatform.googleapis.com/v1/projects/gen-lang-client-0152004313/locations/global/publishers/google/models/gemini-2.5-flash:generateContent
```

Force une sortie structurée via `generationConfig.responseMimeType = "application/json"` et un `responseSchema` :

```json
{
  "type": "object",
  "required": ["setting", "surface", "props", "framing", "light", "palette", "mood"],
  "properties": {
    "setting":  { "type": "string" },
    "surface":  { "type": "string" },
    "props":    { "type": "array", "items": { "type": "string" }, "maxItems": 4 },
    "framing":  { "type": "string" },
    "light":    { "type": "string" },
    "palette":  { "type": "string" },
    "mood":     { "type": "string" }
  }
}
```

Sans schéma, le modèle renvoie de la prose et tu perds le contrôle sur ce qui atterrit dans le prompt final.

### Prompt système du directeur artistique

```
You are an art director for commercial product photography. Given a product, you design ONE
specific scene that makes the product's identity legible at a glance.

Method:
1. Identify what the product is literally made of, where it comes from, and when it is consumed.
2. Derive an environment from that identity — not a generic studio, not a stock background.
   Crisps come from potatoes and farms. San Pellegrino comes from an Italian table.
   Energy drinks belong where energy is spent. A frozen croissant belongs in a morning kitchen.
3. Choose a surface the product physically rests on, and at most four props that belong in that
   world. Every prop must have a reason to be there.
4. Respect the requested theme as a STYLE constraint applied to that environment, not as a
   replacement for it. "Luxe" on crisps is a refined farmhouse, not a marble podium.

Rules:
- Be concrete. "Rustic wooden crate on straw, raw potatoes with soil still on them" beats
  "farm setting".
- Never describe the product's own packaging, label, logo or text. Another system handles that.
- Never include people, hands, faces, other brands, or any text, sign or signage in the scene.
- Keep each field under 25 words.

Input: brand, category, description, flavour, theme.
Output: the JSON object only.
```

### Exemples à mettre dans le prompt (few-shot)

Ils portent l'essentiel de la qualité — ce sont eux qui apprennent au modèle le niveau de spécificité attendu. Reprends les tiens :

- **Chips, thème Classique** → setting : "old stone barn interior, afternoon light through open door" · surface : "rough wooden crate lined with burlap" · props : ["raw potatoes with soil", "scattered straw", "vintage metal scale"] · light : "warm directional daylight from the left, dust in the air".
- **San Pellegrino, thème Été** → setting : "sunlit terrace overlooking an Italian coastal village" · surface : "marble bistro table" · props : ["fresh lemons with leaves", "linen napkin", "small espresso cup"] · light : "midday Mediterranean sun, hard shadows, bright bounce".
- **Croissant Nutella surgelé, thème Classique** → setting : "morning kitchen counter, soft window light" · surface : "white ceramic plate on light oak" · props : ["open Nutella jar", "hazelnuts", "coffee cup", "linen cloth"] · light : "soft diffused morning light from the right".

Deux ou trois exemples suffisent, et ils doivent couvrir des morphologies différentes.

---

## Node « Build Prompt » après modification

Il assemble, sans plus rien inventer :

```
Professional advertising photograph of {brand}{description ? " — " + description : ""}{flavor ? ", " + flavor : ""}.

PRODUCT FIDELITY (highest priority): reproduce the packaging exactly as shown in the reference
images — label artwork, logo, typography, colours and proportions unchanged. Do not redraw,
translate or reinterpret any text printed on the packaging.

SCENE: {ad.setting}. The product rests on {ad.surface}. Nearby: {ad.props joined}.
FRAMING: {ad.framing}
LIGHT: {ad.light}
PALETTE: {ad.palette}
MOOD: {ad.mood}

TECHNICAL: photorealistic commercial product photography, 4:5 vertical, product centred and
occupying about 60% of frame height, shallow depth of field, single hero product.

AVOID: altered or invented packaging text, distorted logo, extra products, hands, faces,
watermarks, added slogans, illustration style, any text or signage in the background.
```

Le bloc FIDELITY et le bloc AVOID ne passent jamais par le directeur artistique. C'est ce qui empêche une scène inventive de dégrader le packaging.

---

## Ce que deviennent les sept thèmes

Ils ne décrivent plus un décor mais une **intention**, transmise au directeur artistique :

- **Classique** — l'environnement d'origine ou de consommation naturelle du produit, traité sobrement.
- **Été** — lumière solaire dure, extérieur, fraîcheur, saturation élevée.
- **Extravagant** — mise en scène théâtrale, couleurs franches, composition inattendue mais crédible.
- **Sport** — contexte d'effort, angle héroïque, contraste marqué.
- **Nuit / Fête** — nocturne, sources colorées, ambiance sociale.
- **Luxe** — sobriété, matériaux nobles, lumière unique, peu d'éléments.
- **Noël / Hiver** — saisonnier, lumière chaude, textures hivernales.

Formulé ainsi, « Luxe » sur des chips donne une ferme raffinée plutôt qu'un podium de marbre incohérent.

---

## Deux options à prévoir dans l'interface

**Direction artistique manuelle.** Un champ libre replié par défaut, « Précisez le décor souhaité (optionnel) ». S'il est rempli, il remplace la sortie du directeur artistique. C'est ce qui te permet de retrouver exactement le contrôle que tu avais avec Sora quand tu as une idée précise. Attention : ce texte alimente le bloc SCENE uniquement, jamais les blocs FIDELITY ni AVOID.

**Trois propositions.** Appeler le directeur artistique une fois en lui demandant trois scènes distinctes, puis générer les trois images. Coût 11,7 centimes au lieu de 3,9, mais un choix réel plutôt qu'un tirage unique. C'est la fonctionnalité qui rapproche le plus l'outil de ta méthode manuelle — tu itérais jusqu'à ce que ça tombe juste.

---

## Vérifier que ça vaut le coût

Compare sur les mêmes photos sources, même thème : gabarit actuel contre pipeline directeur artistique. Quatre produits de familles différentes, deux répétitions. La question n'est pas « est-ce plus joli » mais : le décor est-il plus **spécifique au produit** qu'avant, et le packaging reste-t-il intact. Le second critère est celui qui peut se dégrader en ajoutant de la créativité en amont.
