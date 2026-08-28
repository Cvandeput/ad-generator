# Plan d'implémentation — description produit + directeur artistique

À placer dans le dépôt à côté de `PROMPT-DESCRIPTION-ET-THEMES.md`, qui contient les blocs de thème et le détail du champ description. Ce fichier-ci décrit la mise en œuvre et l'ordre des opérations.

Deux périmètres distincts, à ne pas confondre : ce qui se fait **dans le code** (Claude Code) et ce qui se fait **dans l'interface n8n** (à la main). Aucun des deux ne peut faire le travail de l'autre.

---

## Étape 1 — Champ description (code, ~1 h)

Voir `PROMPT-DESCRIPTION-ET-THEMES.md` partie A pour le détail. En résumé :

- migration idempotente : `ALTER TABLE generations ADD COLUMN description TEXT`, précédée d'un contrôle via `PRAGMA table_info(generations)` ;
- `POST /api/generate` accepte `description`, optionnelle, 120 caractères maximum, tronquée au-delà, débarrassée des sauts de ligne et caractères de contrôle ;
- la description est transmise à n8n dans le corps existant et stockée avec la génération ;
- champ texte sous « Goût / variante », libellé **Description du produit (optionnel)**, placeholder `Ex : croissant fourré au Nutella`, ligne d'aide sur la forme réelle du produit ;
- affichage tronqué sur la carte d'historique.

À faire en premier : sans ce champ, le directeur artistique ne saura pas qu'un « Nutella · snack » est un croissant fourré, et produira une scène générique.

## Étape 2 — Champ direction artistique manuelle (code, ~30 min)

Même traitement, colonne `art_direction TEXT`, champ replié par défaut sous la sélection de thème, libellé « Précisez le décor souhaité (optionnel) », 200 caractères.

Ce texte remplace la sortie du directeur artistique quand il est rempli. Il alimente le bloc SCENE **uniquement** — jamais les contraintes de fidélité produit.

## Étape 3 — Node « Directeur Artistique » (n8n, ~1 h)

Nouveau node HTTP Request inséré entre **Webhook** et **Build Prompt**.

- Méthode POST, URL :
  `https://aiplatform.googleapis.com/v1/projects/gen-lang-client-0152004313/locations/global/publishers/google/models/gemini-2.5-flash:generateContent`
- Authentification : Predefined Credential Type → Google Service Account API → la credential existante.
- Corps : le prompt système et les exemples décrits dans `PIPELINE-DIRECTION-ARTISTIQUE.md`, plus les données produit du webhook.
- `generationConfig.responseMimeType = "application/json"` et le `responseSchema` à sept champs. Sans ça, le modèle renvoie de la prose et le contrôle est perdu.
- Timeout 30 000 ms, et **surtout** : dans l'onglet Settings du node, active *Continue On Fail*. Sans cette option, une erreur du modèle texte fait échouer toute la génération.

## Étape 4 — Repli obligatoire (n8n, ~30 min)

Le node **Build Prompt** doit fonctionner dans les trois cas :

1. `art_direction` rempli par l'utilisateur → il alimente le bloc SCENE, le directeur artistique est ignoré.
2. Directeur artistique OK, JSON valide et complet → ses sept champs alimentent SCENE, FRAMING, LIGHT, PALETTE, MOOD.
3. Directeur artistique en échec, JSON invalide ou champ manquant → repli sur le bloc de thème statique de `PROMPT-DESCRIPTION-ET-THEMES.md`.

Le cas 3 n'est pas optionnel. Un appel réseau supplémentaire est un point de défaillance supplémentaire ; une génération dégradée vaut mieux qu'une erreur, d'autant que l'image coûte le même prix dans les deux cas.

Enveloppe le parsing dans un `try/catch` et vérifie la présence de chaque champ attendu avant de l'utiliser — un JSON syntaxiquement valide mais amputé d'un champ doit lui aussi déclencher le repli.

## Étape 5 — Journaliser le prompt final (code, ~15 min)

La colonne `prompt_used` existe déjà et est alimentée. Vérifie qu'elle reçoit bien le prompt **assemblé final**, pas le gabarit. Sans ça, impossible de comprendre après coup pourquoi une image est ratée.

Ajoute une colonne `art_direction_source TEXT` prenant les valeurs `manual`, `auto` ou `fallback`. C'est ce qui permettra de mesurer le taux de repli en production, et donc la fiabilité réelle du node texte.

---

## Ordre

1 → 2 → 3 → 4 → 5. Les étapes 1 et 2 sont indépendantes du reste et peuvent être livrées seules. Les étapes 3 et 4 forment un tout : ne mets pas le node en production sans son repli.

## Coûts et latence, pour mémoire

Le node texte ajoute de l'ordre du millième d'euro par génération, contre 3,9 centimes pour l'image, et une à trois secondes sur les 30 à 120 existantes. Aucune charge supplémentaire sur le VPS : c'est un appel sortant, pas un calcul local.

## Ce qu'il faut mesurer ensuite

Sur les mêmes photos sources et le même thème, comparer gabarit statique et pipeline complet, sur quatre morphologies de produit (canette, sachet souple, pot, coffret), deux répétitions.

Deux critères, dans cet ordre :

- **le packaging reste-t-il intact** — c'est ce qui peut se dégrader quand on ajoute de la créativité en amont, et c'est rédhibitoire ;
- **le décor est-il spécifique au produit** plutôt qu'interchangeable entre deux marques.

Le second sans le premier ne vaut rien.
