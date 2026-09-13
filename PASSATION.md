# AdCraft — passation

_État au 13 septembre 2026. Document destiné à une nouvelle conversation avec Claude : il doit suffire à reprendre le projet sans relire l'historique._

## 1. Ce qu'est le projet

**AdCraft** génère des visuels publicitaires produit. L'utilisateur dépose 1 à 14 photos, renseigne marque / catégorie / goût / description, choisit un thème (ou écrit son propre décor), et reçoit un visuel **4:5** où le **packaging est conservé à l'identique** — seul le décor est composé par l'IA.

- Production : https://ads.devwork.cloud (VPS Hostinger, `/opt/ad-generator`)
- Dépôt local : `C:\Users\Corentin\Desktop\Projet\ad-generator-repo`
- Auteur : Corentin Vandeput (étudiant 3e année dev, HELHa Mons)

## 2. Architecture

```
navigateur ──HTTPS──▶ nginx (sur l'HÔTE du VPS, pas en conteneur)
                       ├── /       → frontend/ statique (HTML + Tailwind compilé + JS vanilla, zéro framework)
                       └── /api/   → backend Node/Express (conteneur Docker, 127.0.0.1:3000)
backend ──webhook──▶ n8n (déjà installé sur le VPS) ──▶ Vertex AI (Gemini image)
```

| Élément | Détail |
|---|---|
| Front | `frontend/` — pages `index`, `app` (studio), `history`, `login`, `register`, `verify`, `tarifs`, `legal`. Tailwind **compilé** (`npm run build:css` dans `frontend/`), jamais de CDN. Chrome commun (nav, footer, cookies, CGU) dans `js/nav.js`. |
| Backend | `backend/src/` — Express + SQLite (`better-sqlite3`), sessions en base (`connect-sqlite3`). |
| Prompts | `shared/prompt.mjs` = **source unique**. `node tools/build-n8n.mjs` régénère `n8n/generateur-publicite.json`. Ne jamais éditer le JSON n8n à la main. |
| Facturation | `backend/src/billing/` — optionnelle (`BILLING_ENABLED`), mode démo sans clé Stripe. |
| Données | `backend/data/` — `app.db` (SQLite), `sessions.db`, `uploads/`, `outputs/`. Gitignoré. |

**Migrations** : automatiques et additives au démarrage (`ALTER TABLE ADD COLUMN`, `CREATE TABLE IF NOT EXISTS` dans `db.js` et `billing/store.js`). Il n'y a **rien à exécuter à la main** sur la base.

## 3. Ce qui a été fait dans la session du 13/09

### Sécurité (rapport complet : `docs/PENTEST-REPORT.md`)
Pentest dynamique (backend lancé en local + n8n simulé) : 18 constats corrigés, rejoués après correction. Les principaux : inscription publique non voulue, secrets d'exemple acceptés au démarrage, fixation de session, mot de passe à 8 caractères accepté, aucune vérification d'origine (CSRF), uploads validés sur le `Content-Type` déclaré, `package.json` servi en production, pas de CSP, aucune révocation de session possible, quotas par IP au lieu de par compte.

Maintenant en place : refus de démarrer si `SESSION_SECRET`/`N8N_TOKEN` sont absents ou d'exemple ; cookie `__Host-sid` ; `session.regenerate()` au login ; middleware d'origine ; signature binaire des uploads ; CSP stricte (helmet + `nginx/snippets/adcraft-security.conf`) ; `logout-all` et changement de mot de passe ; verrouillage après 8 échecs ; conteneur non-root en lecture seule ; journal d'audit JSON.

### Prompts (`docs/PROMPTS-REVIEW.md`)
Le thème définit désormais le **monde** de l'image (8 arènes pour Sport, interdits explicites : vestiaire, haltère isolée…), le produit choisit la variante. Avant, le Directeur Artistique traitait le thème comme un simple « style » appliqué à l'environnement naturel du produit → d'où le vestiaire blanc avec une haltère. Le DA **voit les photos** maintenant : il dresse l'inventaire des produits (plusieurs photos = plusieurs produits, ou plusieurs produits sur une photo) et le prompt les énumère explicitement. Champ « nombre de produits » dans le studio pour forcer le compte.

### Modèle et coût (`docs/MODELES.md`)
`gemini-2.5-flash-image` est **retiré par Google le 2 octobre 2026**. Défaut passé à `gemini-3.1-flash-image` en 2K (0,101 $/image). Le coût était enregistré à 0,134 $ alors que n8n tournait en 2.5-flash à 0,039 $ (×3,4 trop cher) : il vient maintenant d'une grille par modèle × résolution (`backend/src/pricing.js`), alimentée par le modèle réellement renvoyé par n8n. GPT Image 2.5 évalué et écarté (pas de 4:5 natif, plus cher, politique marques/logos restrictive).

### Interface
Favicon + og:image générés depuis le logo, meta/canonical/robots/sitemap, images du site 9,8 Mo → 0,6 Mo en WebP, navbar commune avec état connecté et menu mobile, bandeau cookies, `legal.html` (mentions, RGPD, cookies, CGU) avec acceptation horodatée et modale de ré-acceptation.

### Abonnements Stripe (`docs/STRIPE-ABONNEMENTS.md`)
Prototype complet et testé, **désactivé par défaut** (`BILLING_ENABLED=false` → aucune route, comportement d'avant). Page `/tarifs.html`, formules Découverte / Starter 9,90 € / Pro 24,90 € / Studio 59 € (30/100/300 générations), pack de 20 générations à 6 €. Quota compté sur la **période de facturation** (pas le mois calendaire), 402 `QUOTA_EXCEEDED` quand il est épuisé. Mode démo sans clé Stripe pour tester les quotas. Webhooks signés testés (idempotence, changement de formule, résiliation, pack).

### Inscription et vérification d'e-mail
Inscription **ouverte** (`REGISTER_MODE=open`), compte créé sur la formule gratuite, puis redirection vers `/tarifs.html?bienvenue=1` pour choisir un abonnement (ou continuer en gratuit). **Vérification d'e-mail obligatoire** avant la première génération : jeton à usage unique stocké en SHA-256, 24 h, renvoi limité à 3/h par IP, page `/verify.html`, bandeau de rappel. Sans elle, un robot créerait des comptes en série pour cumuler les quotas gratuits.

## 4. Ce qui reste à faire, par ordre de priorité

### Urgent
1. **Révoquer la clé Gemini** `AIza…` présente dans le `.env` local (AI Studio → API keys) : elle a circulé. Elle ne sert qu'à `tools/test-gemini.mjs`, jamais à la production.
2. **Changer le mot de passe** du compte `SEED_USERS` (il était en clair dans `.env`) et le remplacer par un hash `b64:` (voir `.env.example`).
3. **Basculer n8n sur `gemini-3.1-flash-image`** avant le 2 octobre, sinon plus aucune génération.

### Avant d'ouvrir le site au public
4. Compléter `frontend/legal.html` : identité de l'éditeur, adresse, numéro BCE, hébergeur, e-mail de contact (zones surlignées en rouge dans la page).
5. Rédiger les **CGV** (prix, reconduction tacite, droit de rétractation de 14 jours et sa renonciation pour un service numérique exécuté immédiatement, remboursement, résiliation).
6. **Statut d'indépendant + TVA** : encaisser des abonnements est une activité commerciale (numéro BCE, statut étudiant-indépendant). Un abonnement SaaS vendu à un particulier d'un autre pays de l'UE est taxable chez lui au-delà de 10 000 €/an cumulés (OSS) ; en dessous, TVA belge. À trancher avec un comptable **avant** d'afficher les prix : HT ou TTC change la marge de 21 %.
7. **SPF, DKIM, DMARC** sur le domaine expéditeur, sinon les e-mails de confirmation partent en indésirables et les inscriptions échouent silencieusement.

### Quand tu veux encaisser
8. Compte Stripe en sandbox, créer 3 produits + 1 prix mensuel chacun + 1 prix unique pour le pack, remplir les `STRIPE_PRICE_*`, activer le Customer Portal, créer l'endpoint webhook. Détail : `docs/STRIPE-ABONNEMENTS.md` §11.

### Confort / dette
9. Valider les nouveaux prompts sur de vraies générations (Sport avec une canette, 2 photos = 2 produits, 3 produits sur une photo).
10. Corriger l'historique des coûts déjà enregistrés à 0,134 $ (commande dans `docs/MODELES.md`).
11. Supprimer les PNG lourds de `frontend/img/site/` (remplacés par `.webp`), `DEPLOY.md` (obsolète et dangereux : il décrit une infra qui n'existe plus), `frontend/_tmp_shots/`.
12. Sauvegardes chiffrées de `backend/data/` hors du VPS. Il n'y en a aucune aujourd'hui.
13. **Aucun test automatisé** dans le dépôt. Tout a été vérifié à la main (curl + Playwright) pendant la session. Un `npm test` minimal sur auth/quota/webhook serait le premier investissement utile.
14. Migration vers PocketBase (`docs/MIGRATION-BAAS.md`) — optionnelle, à faire seulement si la couche auth maison devient pénible.

## 5. Lancer en local (Windows)

```bash
cd C:\Users\Corentin\Desktop\Projet\ad-generator-repo\backend
npm install
npm start            # http://localhost:3000 — le backend sert aussi le front en dev
```

`.env` à la racine du dépôt. En dev (`NODE_ENV` non défini), les secrets manquants sont remplacés par des valeurs éphémères avec un avertissement. Sans n8n joignable, la génération renvoie 502 ; tout le reste fonctionne.

Pour voir la page tarifs : ajouter `BILLING_ENABLED=true`. Sans clé Stripe, mode démo (abonnement simulé en base, rien n'est facturé).
Pour tester la vérification d'e-mail sans SMTP : ne pas définir `SMTP_HOST` → le lien est écrit dans la console du serveur.

Après toute modification de classes Tailwind dans le HTML ou le JS :
```bash
cd frontend && npm install && npm run build:css     # régénère css/app.css, à committer
```

Après toute modification de `shared/prompt.mjs` :
```bash
node tools/build-n8n.mjs     # régénère n8n/generateur-publicite.json
```

## 6. Déployer

Procédure complète et vérifiable : **`docs/DEPLOIEMENT-2026-09.md`**. En résumé : `npm install stripe nodemailer` côté backend **avant** de committer (le Dockerfile fait `npm ci`, il lui faut le `package-lock.json` à jour), puis `git pull` sur le VPS, `chown -R 1000:1000 backend/data` (le conteneur n'est plus root), mettre à jour `.env`, `docker compose build backend && docker compose up -d backend`. La base se migre toute seule au démarrage.

⚠️ Le nouveau `SESSION_SECRET` invalide les sessions : tout le monde devra se reconnecter une fois.

## 7. Conventions du projet

- **Commentaires en français**, et ils expliquent *pourquoi*, pas *quoi*. Les « pièges » (ordre des middlewares, corps brut du webhook Stripe, `current_period_end` déplacé dans l'API Basil) sont commentés sur place.
- Pas de framework front, pas de CDN : tout est servi depuis le domaine (la CSP l'exige).
- Une source unique par sujet : thèmes dans `shared/prompt.mjs`, formules dans `billing/plans.js`, prix des modèles dans `pricing.js`. Ne pas dupliquer une valeur dans le front.
- Les fonctionnalités risquées sont derrière un drapeau d'environnement et **désactivées par défaut** (`BILLING_ENABLED`), pour ne jamais casser ce qui tourne.
- Les secrets ne sont jamais dans le dépôt : `.env` et `sa-key.json` sont gitignorés.

## 8. Documents de référence

| Fichier | Contenu |
|---|---|
| `README.md` | Vue d'ensemble, API, structure |
| `docs/PENTEST-REPORT.md` | Test d'intrusion, 18 constats, preuves avant/après |
| `docs/PROMPTS-REVIEW.md` | Critique thème par thème, multi-produits, Directeur Artistique |
| `docs/MODELES.md` | Prix des modèles image, retrait de 2.5-flash, comparaison GPT Image 2.5 |
| `docs/STRIPE-ABONNEMENTS.md` | Marges, architecture de facturation, code, pièges, TVA, prototype, vérification d'e-mail |
| `docs/MIGRATION-BAAS.md` | Migration optionnelle vers PocketBase |
| `docs/DEPLOIEMENT-2026-09.md` | Procédure de déploiement pas à pas |
| `UPDATE-VPS.md` | État réel du VPS (nginx sur l'hôte, pas en conteneur) |
| ~~`DEPLOY.md`~~ | **Obsolète, ne pas suivre** : décrit une infra qui n'existe plus, l'appliquer coupe le site |

## 9. Décisions ouvertes

- **Prix définitifs** : 9,90 / 24,90 / 59 € sont calculés pour garder ≥ 48 % de marge après coût IA et frais Stripe, mais rien n'a été confronté au marché.
- **Essai gratuit** : 5 générations à vie aujourd'hui. Alternative : 7 jours d'essai sur une formule payante avec carte (filtre mieux les robots, réduit la conversion).
- **Dépassement** : pack de 20 à 6 € aujourd'hui. Alternative : facturation à l'usage (Stripe meters), plus complexe.
- **`gemini-3-pro-image`** (+0,033 $/image) pour les emballages très chargés en texte : à trancher après comparaison sur de vrais produits.
