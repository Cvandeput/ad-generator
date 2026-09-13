# Modèle image : état des lieux et comparaison avec GPT Image 2.5

_Prix publics au 13 septembre 2026 (tarif standard, hors batch/flex). Sources en bas._

## Urgent : le modèle actuel disparaît le 2 octobre 2026

Le workflow n8n tourne sur **`gemini-2.5-flash-image`** (défaut quand `GEMINI_MODEL` est vide). Google **arrête ce modèle le 2 octobre 2026**. Remplaçant officiel : **`gemini-3.1-flash-image`** (Nano Banana 2). Sans action, toutes les générations échoueront à cette date.

Le défaut du workflow régénéré est maintenant `gemini-3.1-flash-image` ; le backend affiche un avertissement au démarrage si `GEMINI_MODEL` pointe encore sur 2.5.

## Grille Google (USD / image)

| Modèle | 0.5K | 1K | 2K | 4K | Notes |
|---|---|---|---|---|---|
| gemini-2.5-flash-image | — | 0.039 | — | — | 1024 px max, pas d'`imageSize`. **Retiré le 02/10/2026** |
| **gemini-3.1-flash-image** (Nano Banana 2) | 0.045 | 0.067 | **0.101** | 0.151 | Remplaçant. Meilleur texte, éditions, suivi de prompt. 14 images de référence |
| gemini-3.1-flash-lite-image | — | 0.0336 | — | — | Pour brouillons rapides |
| gemini-3-pro-image (Nano Banana Pro) | — | 0.134 | 0.134 | 0.24 | Fidélité packaging et texte les plus élevées. Batch/Flex : 0.067 |

Entrées : ~0,0006 $ par image de référence sur 3.x ; négligeable.

## Où en était le calcul du coût (bug signalé)

`COST_PER_IMAGE_USD` valait 0.134 par défaut dans le code (tarif Pro) alors que n8n tournait sur 2.5-flash (0.039) : chaque ligne était enregistrée **3,4× trop cher**, et le studio affichait « ≈ 0,12 € » en dur. Corrigé :

- grille tarifaire dans `backend/src/pricing.js` (modèle × résolution) ;
- n8n renvoie `model` et `imageSize` réellement utilisés → le backend calcule le coût depuis ça, plus depuis une variable qui dérive ;
- `/api/usage` renvoie le **prix unitaire courant** (`unit`) → le studio l'affiche dynamiquement (« ≈ 0,093 € par visuel (gemini-3.1-flash-image 2K) ») et chaque résultat affiche son coût ;
- `COST_PER_IMAGE_USD` reste possible pour forcer un prix (à laisser vide).

Corriger l'historique déjà écrit (une fois, sur le VPS), en supposant que tout a été généré en 2.5-flash :

```bash
docker compose exec backend node -e "const D=require('better-sqlite3');const db=new D('/app/data/app.db');console.log(db.prepare(\"UPDATE generations SET cost_usd=0.039, model=COALESCE(model,'gemini-2.5-flash-image') WHERE status='done' AND cost_usd=0.134\").run())"
```

## GPT Image 2.5 (OpenAI) — sorti le 8 septembre 2026

Deux variantes : **`gpt-image-2.5-flare`** (rapide, défaut) et **`gpt-image-2.5-sunburst`** (précision, échelle de qualité `low/medium/high/xhigh/max`). Tarif identique : 5 $/M tokens texte, 8 $/M tokens image en entrée, **30 $/M tokens image en sortie**. Ordre de grandeur par image 1024² (estimations à partir de la grille GPT Image 2, même tarif) : ~0,006 $ (low), ~0,05 $ (medium), ~0,21 $ (high) ; `xhigh`/`max` au-delà.

| Critère | Gemini 3.1 Flash Image (recommandé) | Gemini 3 Pro Image | GPT Image 2.5 |
|---|---|---|---|
| Prix / visuel qualité « pub » | 0,101 $ (2K) | 0,134 $ (2K) | ~0,21 $ (high, 1024²) — le 2K n'existe pas |
| Formats | ratio libre dont **4:5 natif**, 0.5K→4K | idem | 1024², 1024×1792, 1792×1024 → pas de 4:5, il faut recadrer |
| Images de référence | jusqu'à 14 (déjà exploité) | 14 | oui (`edits`, `input_fidelity`) ; maximum non documenté |
| Marques / logos réels | acceptés (c'est tout le principe d'AdCraft) | acceptés | **politique restrictive sur marques et logos réels** + vérification d'organisation obligatoire → risque de refus ou de logo « réinterprété » sur Red Bull, Nutella… |
| Texte d'emballage | bon à 2K | le meilleur | bon, mais 1024 px max de large |
| Intégration | déjà en place (Vertex, credential SA, n8n) | idem, une variable d'env | nouveau compte, nouvelle facturation, nouveau node |

**Conclusion** : passer à **`gemini-3.1-flash-image` en 2K** maintenant (obligatoire avant le 2 octobre, +0,06 $ par visuel vs 2.5, 4:5 natif, texte bien meilleur). Garder **`gemini-3-pro-image`** comme option « qualité max » pour les emballages très chargés en texte (+0,033 $). **GPT Image 2.5 n'est pas adapté** au cas d'usage : pas de 4:5, plus cher à qualité comparable, et une politique marques/logos qui va bloquer ou altérer précisément ce que l'outil promet de conserver. Le benchmarker sur 5 produits réels reste possible (`tools/test-gemini.mjs` à dupliquer), mais l'obstacle légal/politique prime sur la qualité brute.

## Variables n8n à poser

```
GEMINI_MODEL=gemini-3.1-flash-image
GEMINI_IMAGE_SIZE=2K
GEMINI_TEXT_MODEL=gemini-2.5-flash      # Directeur Artistique (multimodal). Alternative : gemini-3.5-flash
```
et dans `.env` du backend, les mêmes `GEMINI_MODEL` / `GEMINI_IMAGE_SIZE` (affichage du prix avant génération).

## Sources

- Tarifs Gemini : https://ai.google.dev/gemini-api/docs/pricing
- Modèles Gemini : https://ai.google.dev/gemini-api/docs/models
- Retrait de gemini-2.5-flash-image (2 oct. 2026) : https://www.aifreeapi.com/en/posts/gemini-2-5-flash-image-replacement
- GPT Image 2.5 (modèle, tarif) : https://developers.openai.com/api/docs/models/gpt-image-2.5-flare · https://developers.openai.com/api/docs/pricing · https://developers.openai.com/api/docs/guides/image-generation
- Tarifs par image et sortie du 8 sept. : https://www.eesel.ai/blog/chatgpt-images-2-5-pricing
- Test GPT Image 2.5 : https://www.mindstudio.ai/blog/gpt-image-25-review
