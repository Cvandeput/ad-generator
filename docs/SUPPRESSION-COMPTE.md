# Suppression de compte — ce qui est effacé, ce qui est conservé, pourquoi

État au **17 septembre 2026**, mis à jour le **25 septembre 2026** (ordre fichiers/transaction,
résiliation Stripe, adresses `.invalid`, générations en cours). Complète l’audit RGPD interne (non versionné) §1.3
(constats 1.21, 1.24, 1.25), qui classait l'absence de suppression par l'utilisateur en **P0**.

Code : `backend/src/deletion.js` (mécanique commune), `backend/src/routes/account.js` (par
l'utilisateur), `backend/src/routes/admin.js` (par un administrateur), `backend/src/identity.js`,
`backend/src/storage.js`.

---

## 1. La tension à résoudre

Le besoin exprimé : permettre à l'utilisateur de supprimer son compte **tout en gardant une trace
de l'activité passée**. Ce besoin est réel et légitime. Le satisfaire en se contentant de
désactiver le compte ne l'est pas.

- **L'art. 17 RGPD** donne un droit à l'effacement. Conserver l'intégralité du profil sous un
  drapeau `deleted = 1`, c'est continuer exactement le même traitement avec une colonne en plus.
  Ce n'est pas un effacement, c'est un renommage.
- **L'art. 17(3)(b)** prévoit bien une exception pour les obligations légales. En Belgique, la
  **conservation comptable de 7 ans** en est une (*durée à confirmer avec un comptable, non
  certifiée ici ; l’audit RGPD interne (non versionné) §5 la retient déjà sous la même réserve*).
- Mais cette exception couvre les **données de facturation**. Pas l'adresse e-mail, pas le
  hachage du mot de passe, pas les photos de produit.

**La réponse technique est la pseudonymisation** : on casse le lien entre la ligne et la
personne, on garde la ligne. L'exploitant garde sa trace comptable ; la personne n'est plus
identifiable à partir de la base seule (réserve : `stripe_customer_id` permet de la retrouver chez
Stripe, cf. §3). Les deux besoins sont satisfaits sans arbitrage.

---

## 2. Ce qui est effacé

| Donnée | Traitement | Pourquoi |
|---|---|---|
| `users.email` | Remplacée par `deleted+<id>@account.invalid` | `.invalid` est réservé par la RFC 2606 : l'adresse ne se résout jamais et n'appartient à personne. La contrainte `UNIQUE` reste satisfaite grâce à l'`id`. Pour que cela reste vrai, toute adresse en `.invalid` est **refusée** à l'inscription (même réponse qu'une adresse mal formée) et ignorée dans `SEED_USERS` : sans ce refus, quelqu'un pourrait réserver `deleted+42@account.invalid`, et la suppression du compte 42 échouerait sur `UNIQUE` — après la résiliation Stripe. |
| `users.password_hash` | Écrasé par un bcrypt d'aléa | Un hash **valide** et non une chaîne bidon : un hash malformé ferait échouer `bcrypt.compare()` instantanément et rétablirait l'oracle temporel que `routes/auth.js` prend soin de neutraliser. |
| `users.terms_version`, `terms_accepted_at`, `last_login_at` | `NULL` | Traces de comportement, sans utilité comptable. |
| `users.withdrawal_consent_ip` | `NULL` | Une IP est une donnée personnelle. L'horodatage et la version du consentement restent (valeur probatoire, non identifiante). |
| `users.extra_credits` | `0` | Un compte supprimé n'a plus de solde. |
| `users.failed_logins`, `locked_until` | Remis à zéro | Journal de sécurité sans objet une fois le compte clos. |
| **Photos déposées** (`data/uploads/<genId>/`) | **Supprimées du disque** | Décision explicite. Une photo de produit peut contenir un visage ou une plaque : c'est de la donnée personnelle même si ce n'est pas celle du client (`PASSATION.md` §4 le relevait déjà). Aucune obligation comptable ne porte sur des pixels — seulement sur des montants. |
| **Visuels générés** (`data/outputs/`) | **Supprimés du disque** | Même raisonnement. Ils dérivent directement des photos. |
| `generations.prompt_used`, `description`, `art_direction` | `NULL` | Champs de texte libre saisis par la personne. Aucune obligation comptable n'y touche. |
| `generations.output_path` | `NULL` | Le fichier n'existe plus ; garder le chemin serait un pointeur mort. |
| `auth_tokens` | Supprimés | Ils permettraient de réactiver une adresse qui n'existe plus. |
| **Sessions** (tous appareils) | Détruites | `destroyUserSessions()`. Sans ça, un onglet ouvert continue de fonctionner. |
| **Abonnement Stripe** | **Résilié** | Voir §4 — c'est le point qui coûte le plus cher s'il est oublié. |

**Ordre des opérations** (`pseudonymizeUser`, `backend/src/deletion.js`) :

1. **Une seule transaction SQL** relève d'abord les fichiers du compte (`output_path` et
   identifiants de génération), puis pseudonymise `users`, vide les champs de `generations` et
   supprime les jetons. Un effacement à moitié fait (adresse neutralisée mais mot de passe intact,
   ou l'inverse) serait pire que pas d'effacement du tout.
2. **Après le commit seulement**, les fichiers relevés sont effacés du disque, puis les sessions
   détruites.

Si le SQL échoue, rien n'a été effacé : le compte reste entier, images comprises, et la
suppression peut être retentée. L'ordre inverse (fichiers d'abord) laissait, en cas d'échec du SQL,
un compte intact dont les images avaient disparu. Limite connue : l'effacement d'un fichier qui
échoue (verrou, droits) est ignoré en silence ; le fichier reste alors sur le disque sans chemin en
base. Il reste retrouvable par son nom (`outputs/<id>.<ext>`, `uploads/<id>/`), l'`id` étant celui
d'une génération d'un compte supprimé.

**Génération en cours pendant la suppression.** L'appel à n8n dure plusieurs secondes. Une
génération qui se termine après la suppression ne réécrit rien : la mise à jour finale de
`routes/generate.js` ne touche que les lignes d'un compte actif (`user_id IN (SELECT id FROM users
WHERE deleted_at IS NULL)`) ; si aucune ligne n'est touchée, l'image produite est effacée aussitôt
et la requête reçoit 401. La création de la génération en attente porte la même garde. Conséquence
assumée : la ligne reste `pending` avec un coût de 0, alors que l'appel au modèle a pu être facturé
par le fournisseur.

---

## 3. Ce qui est conservé, et sous quelle justification

| Donnée | Durée | Base légale / motif |
|---|---|---|
| Ligne `users` (id, `created_at`, `deleted_at`, `deletion_reason`) | 7 ans | Art. 17(3)(b) : support de rattachement des écritures comptables. Ne contient plus rien d'identifiant. |
| Lignes `generations` : date, marque, catégorie, thème, statut, **coût** | 7 ans | La trace comptable recherchée. C'est ce qui permet de justifier un chiffre d'affaires et une consommation d'API. Rattachées à l'`id` désormais pseudonyme. |
| `users.stripe_customer_id` | 7 ans | Sans lui, impossible de relier une facture Stripe à une écriture comptable. **Pseudonyme, pas anonyme** : quiconque a accès au compte Stripe retrouve, à partir de cet identifiant, le nom, l'adresse e-mail et le moyen de paiement du client. La ligne reste donc une donnée personnelle ; sa conservation repose sur l'obligation comptable, pas sur une absence de réidentification. |
| Table `withdrawals` | 7 ans | Justification de chaque remboursement (cf. `docs/RETRACTATION.md` §4.4). |
| **`users.email_hash`** | 7 ans | Voir §5 — c'est le choix le plus discutable du lot, donc celui qui est le plus argumenté. |
| Factures chez Stripe | Selon Stripe | Stripe conserve légitimement les factures au titre de ses propres obligations. L'effacement total n'est pas exigible, mais **l'utilisateur doit en être informé** (art. 17(3)(b)) — c'est fait dans la modale de confirmation et dans `account.delete.kept`. |

---

## 4. La résiliation Stripe — l'ordre des opérations compte

**Stripe d'abord, base ensuite.** Si la résiliation échoue, la route renvoie **503** et
**rien n'est supprimé**.

Le scénario évité est précis : supprimer d'abord et résilier « quand ça remarchera » produit un
compte sans accès, sans adresse e-mail pour prévenir qui que ce soit, **et un prélèvement mensuel
qui continue de tourner**. C'est le pire état atteignable, et il est irréparable côté client
puisqu'il n'a plus de compte pour se plaindre.

Déroulé de `cancelSubscription` (`backend/src/deletion.js`), identique pour les deux chemins
(utilisateur et console d'administration) :

- **Stripe fait foi, pas la copie locale.** Si une clé Stripe est configurée et que le compte a un
  `stripe_customer_id`, ses abonnements sont listés chez Stripe (`status: 'all'`) et tout ce qui
  n'est pas terminé (`active`, `trialing`, `past_due`, `unpaid`, `incomplete`, `paused`) est
  résilié. Un webhook manqué suffit à ce qu'un abonnement actif soit absent de la base.
- **« Inexistant » et « déjà résilié » sont des succès.** L'erreur Stripe `resource_missing`, ou un
  abonnement que Stripe donne déjà comme terminé, ne bloque pas la suppression : aucun prélèvement
  ne tourne, c'est le but. Toute autre erreur est propagée (503, rien n'est supprimé).
- **Abonnements de démonstration** (identifiant `demo_…`) : jamais envoyés à Stripe, où ils n'ont
  jamais existé ; ils sont marqués résiliés en base. Sans clé Stripe (**mode démo**), la résiliation
  est simulée en base, exactement comme le reste de `billing/routes.js`.
- **Indépendant de `BILLING_ENABLED`** : un abonnement souscrit pendant que la facturation était
  active continue de prélever après qu'on l'a désactivée. Les colonnes `extra_credits` et
  `stripe_customer_id` sont créées par `db.js` quelle que soit la configuration, pour que la
  suppression fonctionne aussi sur une base qui n'a jamais eu la facturation.

---

## 5. L'empreinte d'e-mail — pourquoi la conserver, et sous quelle forme

**Le problème.** Neutraliser l'adresse la **libère**. La même personne se réinscrit et récupère
un quota gratuit neuf. `backend/src/config.js` documente déjà cet abus pour `REGISTER_MODE=open` :
« un robot peut créer N comptes pour cumuler N quotas gratuits ». Supprimer/recréer en devient la
version manuelle, et elle contourne la vérification d'e-mail puisque l'adresse est réelle.

**La solution retenue** : conserver une **empreinte HMAC-SHA256** de l'adresse, jamais l'adresse.

- **HMAC et pas SHA-256 nu.** Un SHA-256 d'adresse e-mail se casse en quelques minutes avec une
  liste d'adresses courantes : l'espace est petit et prévisible. Le poivre serveur rend le calcul
  impossible sans le secret — c'est la différence entre « pseudonymisé » et « juste encodé ».
- **Poivre** : `EMAIL_HASH_PEPPER` (`.env`, recommandé ; 32 caractères minimum, plus court il est
  ignoré). À défaut, une valeur aléatoire est générée et **persistée en base** (table `app_meta`,
  clé `email_hash_pepper`). Un avertissement est écrit dans le journal **une seule fois**, au moment
  où le poivre est généré — c'est-à-dire à la première empreinte calculée (inscription ou
  suppression), pas à chaque démarrage. La valeur elle-même n'est **jamais** journalisée : le
  message donne la requête SQL pour la relire. C'est **cette** valeur qu'il faut recopier dans
  `EMAIL_HASH_PEPPER` ; en générer une nouvelle rendrait toutes les empreintes existantes
  inutilisables. Ce repli est plus faible (une fuite de la base livre le poivre avec les
  empreintes) mais il évite le pire : un poivre qui changerait à chaque redémarrage rendrait toutes
  les empreintes incomparables et la détection tomberait **en silence**.
- **Normalisation** : minuscules + espaces retirés. On s'arrête là. Retirer les points ou le
  `+tag` serait plus agressif, mais ces variantes sont des adresses **distinctes** chez beaucoup
  de fournisseurs : on refuserait le quota gratuit à quelqu'un qui n'a jamais eu de compte.

**Ce que l'empreinte permet, et ce qu'elle ne permet pas.** Elle répond à « cette adresse a-t-elle
déjà eu un compte ? ». Elle ne permet pas de retrouver l'adresse, ni de dresser un profil, ni de
recontacter qui que ce soit.

**Effet à la réinscription** : le compte est **créé normalement** — revenir est un droit — mais
avec `free_quota_forfeited = 1`, donc **zéro génération offerte**. Il peut s'abonner
immédiatement. Ce qui est refusé, ce n'est pas l'accès, c'est le cumul de quotas gratuits.

> **À signaler dans l'information des personnes** : cette conservation doit figurer dans la
> politique de confidentialité (finalité : prévention des abus ; base légale : intérêt légitime ;
> durée : 7 ans). Elle n'y est **pas encore** — c'est un point ouvert, cf. §8.

---

## 6. Inventaire des requêtes filtrées

C'est la partie où un seul oubli suffit à faire revivre un compte supprimé. Inventaire obtenu
par `grep -rn "FROM users\|INTO users\|UPDATE users\|JOIN users" backend/src`, **traité ligne à
ligne**.

### 6.1 Filtres ajoutés (`AND deleted_at IS NULL`)

| Fichier | Requête | Conséquence de l'oubli |
|---|---|---|
| `routes/auth.js` | `SELECT * FROM users WHERE email = ?` (**connexion**) | **Le compte supprimé se reconnecte.** Le filtre le plus critique. |
| `routes/auth.js` | `SELECT * FROM users WHERE id = ?` (**`/me`**) | Le compte réapparaît dans l'interface ; la session est maintenant détruite au passage. |
| `routes/auth.js` | `SELECT * … WHERE id = ?` (changement de mot de passe) | Réactivation d'un accès par changement de mot de passe. |
| `routes/auth.js` | `UPDATE … terms_version` (acceptation CGU) | Écriture sur une ligne pseudonymisée. |
| `routes/auth.js` | `UPDATE … email_verified` + relecture (vérification d'e-mail) | Un vieux jeton réactiverait le compte. Les jetons sont aussi supprimés. |
| `routes/auth.js` | `SELECT email …` / `SELECT * … WHERE email = ?` (renvoi de lien) | Envoi d'un e-mail vers une adresse neutralisée. |
| `admin.js` | `isAdmin()` | **Un ancien admin supprimé rouvrirait la console d'administration.** |
| `admin.js` | `syncAdmins()` : promotion, décompte, avertissement | Re-promotion d'un compte supprimé au démarrage. |
| `middleware/requireVerified.js` | `SELECT email, email_verified, role …` | Le compte passerait le middleware et atteindrait `/api/generate`. Renvoie désormais 401. |
| `billing/store.js` | `getUser()` — **le socle de `quotaState()`** | Un compte supprimé obtiendrait un quota. |
| `billing/store.js` | `getUserByCustomer()` — **webhook Stripe** (repli quand l'événement ne porte pas `metadata.userId`) | Rattachement d'un événement Stripe à un compte supprimé. **Ce filtre seul ne suffit pas**, voir la note ci-dessous. |
| `billing/store.js` | `setCustomerId()`, `addCredits()`, `consumeCredit()` | Un paiement arrivant après la suppression recréditerait la ligne. |
| `billing/quota.js` | `quotaState()` | Garde ajouté : `user` absent → quota nul, statut `deleted`, au lieu de planter sur `user.created_at`. |
| `routes/admin.js` | liste, crédits, déverrouillage, vérification, suppression | Actions d'administration sur un compte clos. |
| `routes/generate.js` | Création de la génération en attente, mise à jour finale | Une génération en vol au moment de la suppression réécrirait `output_path`/`prompt_used` sur la ligne pseudonymisée et laisserait l'image sur le disque (cf. §2). |

> **Le filtre de `getUserByCustomer()` ne protège pas à lui seul le webhook Stripe.** Il ne sert
> que de repli : le webhook identifie d'abord le compte par `metadata.userId`, que Checkout pose
> sur chaque abonnement et sur chaque achat de pack. Or `upsertSubscription()`, `setLastPayment()`
> et `insertCreditPurchase()` ne filtrent pas `deleted_at`. La protection doit donc se faire dans
> le traitement des événements (`billing/routes.js` : `syncSubscription()`, crédit de pack), en
> écartant tout événement dont le compte est supprimé. Ce traitement ne fait pas partie de la
> mécanique de suppression décrite ici ; il est à vérifier avant de considérer le webhook comme
> protégé (cf. §8). Ce qui est acquis dans tous les cas : un événement tardif ne **rouvre pas
> l'accès**, car toutes les lectures qui donnent un droit (connexion, `/me`, `quotaState()`,
> `requireVerified`) excluent les comptes supprimés, et `addCredits()` est filtré.

### 6.2 Requêtes volontairement NON filtrées — et pourquoi

| Fichier | Requête | Raison |
|---|---|---|
| `routes/auth.js` | Contrôle de doublon à **l'inscription** | L'adresse est neutralisée, donc **libre**. Revenir est un droit. C'est `email_hash` qui gère l'abus, pas un refus d'inscription. |
| `routes/admin.js` | `/users?deleted=1` | La seule requête qui doit **voir** les comptes supprimés : c'est l'accès admin aux comptes désactivés. |
| `routes/admin.js` | Vue d'ensemble | Les supprimés sortent des totaux **et** sont comptés séparément (`deleted.total`). |
| `db.js:84` | `UPDATE users SET email_verified = 1` | Migration ponctuelle, exécutée une seule fois à l'ajout de la colonne, avant que la suppression n'existe. |
| `seed.js` | `SELECT id FROM users WHERE email = ?` | Comptes de l'exploitant, posés par `SEED_USERS`. Une adresse supprimée étant neutralisée, la requête ne la trouve pas et un compte neuf est créé — comportement voulu. Une entrée en `.invalid` est ignorée avant la requête : elle ne peut donc jamais retrouver la ligne d'un compte supprimé. |

### 6.3 Preuve

- `backend/tests/account-deletion.test.js` (facturation activée) : connexion refusée, absence de
  `/me`, quota gratuit déchu à la réinscription, adresse absente de la base, empreinte présente,
  historique non récupéré.
- `backend/tests/admin-deletion.test.js` : la suppression par la console produit le même état et
  conserve les lignes `generations`.
- `backend/tests/deletion-no-billing.test.js` (**facturation jamais activée**) : suppression qui
  aboutit et efface un vrai visuel et une vraie photo du disque, inscription refusée en
  `.invalid`, génération terminée après la suppression sans réécriture ni fichier restant.
- `backend/tests/cancel-subscription.test.js` : résiliation Stripe contre une doublure du SDK
  (démo jamais envoyée, liste Stripe prioritaire, `resource_missing` et « déjà résilié » acceptés,
  autre erreur propagée).

---

## 7. Sécurité de la route

- `POST /api/account/delete`, derrière `requireAuth`.
- **Ré-authentification par mot de passe obligatoire.** La session seule ne suffit pas pour une
  action irréversible (poste laissé ouvert, session volée).
- **CSRF** : la vérification d'origine de `middleware/csrf.js` s'applique à tout `/api` en
  mutation.
- **Limite de débit** : 10 tentatives / 15 min, comme la connexion — sinon la route devient un
  oracle pour tester des mots de passe volés.
- **Refus pour un compte administrateur** (409, `ADMIN_ACCOUNT`) : `syncAdmins()` le recréerait au
  prochain démarrage depuis `ADMIN_EMAILS`, le compte reviendrait à moitié. Le message dit quoi
  faire d'abord.
- **Journal structuré** : `account.deleted` avec le nombre de fichiers, de générations, de
  sessions révoquées et l'état de la résiliation Stripe.

Une route de lecture accompagne la suppression : `GET /api/account/deletion-preview` renvoie ce
qui sera effacé et conservé. La modale de confirmation affiche donc des **chiffres réels**, pas un
texte générique — elle ne peut pas mentir sur ce qui va se passer.

---

## 8. Ce qui reste à faire

| # | Point | Nature |
|---|---|---|
| 1 | **Compléter la politique de confidentialité** : la conservation de `email_hash` (finalité, base légale, durée), la pseudonymisation, et la rétention comptable de 7 ans. `legal.html` §2 ne les mentionne pas. | Rédaction + décision de l'exploitant. |
| 2 | **Confirmer la durée de 7 ans** avec un comptable. Elle est reprise de l’audit RGPD interne (non versionné) §5, qui la donne déjà sous réserve. | Décision externe. |
| 3 | **Export des données** (art. 20, `GET /api/account/export`) — toujours absent. L’audit RGPD interne (non versionné) 1.22 le classe P1. Un utilisateur qui supprime son compte voudra souvent récupérer ses visuels d'abord. | Développement, hors périmètre. |
| 4 | **Purge de rétention** : aucun job n'existe (audit RGPD interne non versionné, 1.27, P0). La suppression volontaire est maintenant possible, mais rien n'expire tout seul. | Développement, hors périmètre. |
| 5 | **Poser `EMAIL_HASH_PEPPER` dans `.env`** sur le VPS. Sans lui, le poivre est généré et stocké en base — ça marche, c'est juste plus faible. S'il a déjà été généré, recopier la valeur **existante** (`SELECT value FROM app_meta WHERE key = 'email_hash_pepper'`), jamais une nouvelle. | Une ligne de configuration. |
| 6 | **E-mail de confirmation de suppression** sur support durable. Non codé ; le SMTP existe. | Rédaction. |
| 7 | **Webhook Stripe et comptes supprimés** : vérifier que `syncSubscription()` et le crédit de pack écartent tout événement dont le compte est supprimé, et qu'un test le verrouille. Cf. la note du §6.1. | Vérification (`billing/`). |
