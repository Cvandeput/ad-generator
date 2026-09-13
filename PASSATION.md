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

### Déploiement (fait le 13/09 au soir)
Le VPS tourne la version de cette session. Ont été exécutés : rotation de `SESSION_SECRET` et `N8N_TOKEN` (le nouveau jeton est aussi posé dans le compose n8n, `/opt/n8n-compose/docker-compose.yml`), `chown 1000:1000 backend/data`, `git pull`, reconstruction de l'image backend, installation du snippet nginx.

Deux incidents, tous deux de mon fait, résolus et à connaître : le `Dockerfile` faisait `npm ci` sur un lock qui épingle `better-sqlite3@13.0.3`, sans prebuild pour Node 24 → compilation `node-gyp` impossible faute de Python dans l'image. Corrigé par un **build en deux étapes** (les outils de compilation restent dans l'étage `deps`). Et un `cap_drop: ALL` ajouté au compose avait retiré `CAP_DAC_OVERRIDE` à root, d'où un `SQLITE_READONLY` en boucle tant que l'image tournait encore en root ; réglé par l'image non-root définitive (uid 1000).

**Incident vhosts (13/09, ~20 h)** : les trois fichiers de `/etc/nginx/sites-available/` (`ads.devwork.cloud`, `site1`, `site2`) se sont retrouvés **vides**, très probablement à cause de blocs multi-lignes collés dans le terminal dont une partie a été interprétée comme commande pendant que la sortie précédente défilait. Conséquence : plus aucune écoute sur le port 443, les trois sites HTTPS hors ligne (AdCraft continuait de répondre tant que nginx tournait sur sa config en mémoire). Rétabli depuis `/root/vhost-adcraft.bak` puis reconstruit : les trois vhosts sont désormais **versionnés dans `nginx/vhosts/`** — en cas de récidive, `sudo cp nginx/vhosts/* /etc/nginx/sites-available/ && sudo nginx -t && sudo systemctl reload nginx` suffit. `site1` = `devworks.be` (portfolio, PHP 8.1-FPM pour `send-email.php`), `site2` = `devwork.cloud` (redirection 301 vers AdCraft ; le contenu de `/var/www/site2` est conservé sur le disque). Leçon : sur ce VPS, coller **une commande à la fois**.

nginx : `include snippets/adcraft-security.conf;` ajouté au vhost, `add_header Cache-Control "no-store"` sur `/api/`, `listen 443 ssl http2` (nginx 1.18 ne connaît pas la directive `http2 on;`). Le cache des `.js`/`.css` est en `no-cache` (revalidation par ETag) et non en `max-age` : les noms de fichiers ne portent pas de hash, un cache ferme rendait chaque déploiement invisible pendant une heure — c'est ce qui a fait échouer le premier chargement de la console d'administration. Vérifié : CSP/HSTS/X-Frame/Referrer/Permissions-Policy présents, `/package.json` et `/tailwind.config.js` en 404, toutes les pages et tous les assets en 200. Sauvegarde du vhost dans `/root/vhost-adcraft.bak`.

## 4. Ce qui reste à faire, par ordre de priorité

### Urgent
1. **Révoquer la clé Gemini** `AIza…` présente dans le `.env` local (AI Studio → API keys) : elle a circulé. Elle ne sert qu'à `tools/test-gemini.mjs`, jamais à la production.
2. **Changer le mot de passe** du compte `SEED_USERS` (il était en clair dans `.env`) et le remplacer par un hash `b64:` (voir `.env.example`).
3. **Vérifier le workflow n8n réimporté** : `n8n/generateur-publicite.json` a été importé dans le workflow existant (même path `generate-ads`, pas de second workflow pour éviter le conflit d'activation), credentials Google resélectionnées à la main — l'import ne les transporte pas. Confirmer que `GEMINI_MODEL=gemini-3.1-flash-image` est bien dans l'environnement du conteneur n8n : `gemini-2.5-flash-image` est retiré le 2 octobre, après quoi plus rien ne génère.

   L'UI n8n n'est pas exposée : tunnel `ssh -N -L 5678:172.17.0.1:5678 root@<vps>` puis `http://localhost:5678`.

### Avant d'ouvrir le site au public
4. Compléter `frontend/legal.html` : identité de l'éditeur, adresse, numéro BCE, hébergeur, e-mail de contact (zones surlignées en rouge dans la page).
5. Rédiger les **CGV** (prix, reconduction tacite, droit de rétractation de 14 jours et sa renonciation pour un service numérique exécuté immédiatement, remboursement, résiliation).
6. **Statut d'indépendant + TVA** : encaisser des abonnements est une activité commerciale (numéro BCE, statut étudiant-indépendant). Un abonnement SaaS vendu à un particulier d'un autre pays de l'UE est taxable chez lui au-delà de 10 000 €/an cumulés (OSS) ; en dessous, TVA belge. À trancher avec un comptable **avant** d'afficher les prix : HT ou TTC change la marge de 21 %.
7. **SPF, DKIM, DMARC** sur le domaine expéditeur, sinon les e-mails de confirmation partent en indésirables et les inscriptions échouent silencieusement.


### RGPD — rien n'est en place, ni technique ni documentaire
Le RGPD n'est pas une fonctionnalité de la base : c'est un cadre à implémenter. Données personnelles réellement traitées aujourd'hui : e-mail et hash du mot de passe (`users`), historique des générations avec prompts et coûts (`generations`), **les photos déposées, écrites sur disque** (`backend/data/uploads/**/input_XX.*`), les visuels produits, les jetons d'authentification, les sessions, les IP dans les journaux nginx et le rate-limiting, et l'identifiant client Stripe dès que la facturation sera active. Une photo de produit peut contenir un visage ou une plaque : c'est de la donnée personnelle même si ce n'est pas celle du client.

À coder (une demi-journée) :

- ~~Purge des fichiers d'entrée~~ — **fait** : `DELETE /api/generation/:id` effaçait déjà le dossier d'entrée ; la logique est désormais centralisée dans `backend/src/storage.js` (`purgeGenerationFiles`), réutilisée par la console d'administration.
- **Suppression de compte par l'utilisateur lui-même** (`DELETE /api/account`) — n'existe pas. Un admin peut supprimer un compte depuis la console (lignes + fichiers + sessions), mais l'article 17 suppose que l'utilisateur puisse le faire sans passer par toi, ou au minimum qu'un moyen de contact soit publié. Ajouter aussi la résiliation Stripe dans la foulée.
- **Export des données** (`GET /api/account/export`, art. 20) — JSON des lignes + archive des images.
- **Rétention** — aucune purge n'existe. Fixer une durée, l'écrire dans la politique de confidentialité, et l'appliquer par un job au démarrage sur le modèle de `purgeExpiredTokens` (proposition : générations et fichiers à 12 mois, comptes inactifs à 24 mois, journaux à 6 mois).

À rédiger, avant d'ouvrir les inscriptions au public :

- Une **politique de confidentialité** distincte des mentions légales : finalités, bases légales (exécution du contrat pour le service, intérêt légitime pour les journaux de sécurité, obligation légale pour la facturation), durées de conservation, destinataires, droits et moyen concret de les exercer, contact.
- Le **registre des traitements** (art. 30) — un tableau suffit à cette échelle, mais il est obligatoire, le traitement n'étant pas occasionnel.
- **Sous-traitants et transferts hors UE** : Google (Vertex AI — noter la région utilisée), Stripe, Hostinger, le relais SMTP. Accepter leurs DPA et les citer nommément dans la politique.
- **Cookies** : le seul cookie est `__Host-sid`, strictement nécessaire au service → **aucun consentement requis**. Le bandeau actuel est informatif et ne doit pas bloquer le site. Cela change dès le premier outil d'analyse ou pixel ajouté.

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

## 10. Comptes administrateur

Le rôle vient de `ADMIN_EMAILS` dans `.env` (adresses séparées par des virgules), **jamais d'une requête HTTP** : on ne peut pas se promouvoir depuis l'application, il faut un accès au serveur. `syncAdmins()` applique la liste à chaque démarrage, dans les deux sens — retirer une adresse retire le rôle. Une adresse listée qui s'inscrit ensuite est admin dès la création (`roleFor`).

Un compte admin : **aucun quota** (`quotaState` court-circuité, `planKey: 'admin'`), pas de blocage sur la confirmation d'e-mail, et accès à `/admin.html`. Les routes `/api/admin/*` répondent **404** à tout autre compte, pour ne pas confirmer leur existence.

La console donne : volumétrie et coûts (total, mois, jour), répartition par modèle et par thème, taux de repli du Directeur Artistique, liste des comptes (formule, générations, coût, crédits, verrouillage, confirmation), et l'historique des 100 dernières générations avec leur erreur. Actions : offrir ou retirer des crédits, confirmer une adresse à la main, déverrouiller un compte, révoquer toutes ses sessions, supprimer une génération (ligne + fichiers), supprimer un compte (lignes + fichiers + sessions). Un compte admin ne peut pas être supprimé depuis la console.

```
ADMIN_EMAILS=vdp.corentin@gmail.com,info@garage-vandeput.be
```
