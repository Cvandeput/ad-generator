# Droit de rétractation — raisonnement, formule, garde-fous

État au **25 septembre 2026**. Ce document explique *pourquoi* le code fait ce qu'il fait.
Le code lui-même est dans `backend/src/billing/withdrawal.js` et `backend/src/billing/routes.js`.

> **Ce n'est pas un avis juridique.** C'est une analyse technique sourcée, dans le prolongement
> de la revue juridique interne (non versionnée) §3.3, dont elle reprend les conclusions. Les points incertains sont
> signalés comme tels. Un point demande un arbitrage de l'exploitant : §7.

---

## 1. Le point de départ : ce qui a été demandé, et pourquoi ça ne marche pas

La demande de départ : ajouter la rétractation, mais **sous conditions**. Le cas qui inquiétait :
un abonné qui a déjà consommé 60 générations sur les 100 de sa formule, puis demande à être
remboursé — ces 60 générations ont un coût réel d'API, déjà dépensé.

**La crainte est parfaitement fondée.** La solution envisagée — des conditions qui restreignent le
droit — ne l'est pas, et l'aggrave.

Une clause du type « pas de remboursement au-delà de 50 % du quota consommé » est une **clause
abusive**, réputée **non écrite** (livre VI du Code de droit économique, transposant la directive
2011/83/UE ; la directive interdit expressément de faire supporter au consommateur des charges
non prévues). Concrètement, si un client la conteste :

| | Avec une clause restrictive | Avec le prorata |
|---|---|---|
| Ce que le client obtient | La clause tombe → **remboursement intégral** (24,90 €) | Le solde non consommé (9,96 €) |
| Ce que l'exploitant garde | 0 € | **14,94 €** |
| Risque supplémentaire | Clause illicite affichée publiquement, exploitable par l'Inspection économique | Aucun |

**La clause censée protéger coûte donc exactement l'inverse de ce qu'elle promet.** Elle ne
transforme pas un remboursement partiel en zéro remboursement ; elle transforme un remboursement
partiel en remboursement total.

## 2. Ce qui protège réellement : l'article 14(3)

Le mécanisme que l'exploitant cherchait existe déjà dans la loi, et il est opposable.

- **Le droit existe** : 14 jours pour un contrat de service conclu à distance avec un
  consommateur (art. VI.47 CDE / art. 9 de la directive).
- **L'exception de l'art. VI.53, 1° ne s'applique pas** à un abonnement mensuel. Elle exige un
  service **pleinement exécuté**. Un abonnement en cours ne l'est pas : il reste des générations
  à fournir jusqu'à la fin du mois. Le droit subsiste. C'est l'erreur que font la plupart des
  SaaS, et c'est celle qui coûte cher quand elle est contestée.
- **Mais l'art. 14(3) de la directive** dispose que le consommateur qui a demandé que
  l'exécution commence pendant le délai doit payer **« un montant proportionnel à ce qui lui a
  été fourni »** jusqu'à sa rétractation.

60 générations sur 100 → il a reçu 60 % du service → il paie 60 %. On rembourse 40 %.
**C'est exactement la protection recherchée, et elle tient devant un juge.**

- **La renonciation par génération est, elle, défendable** : chaque visuel livré est un contenu
  numérique fourni au sens de l'art. VI.53, 13°. C'est précisément ce que le prorata exprime.

## 3. La formule

```
remboursé = payé × (1 − fourni / quota)
```

Implémentée par `proratedRefundCents()` (`backend/src/billing/withdrawal.js`), en **centimes
entiers**. Quatre règles, et aucune n'est cosmétique :

### 3.1 Sans consentement exprès, le remboursement est INTÉGRAL

Le prorata de l'art. 14(3) n'existe **que si** le consommateur a expressément demandé
l'exécution immédiate. Sans cette trace, réclamer une part du prix n'a aucun fondement.

C'est pour cela que `POST /api/billing/checkout` **refuse la vente** (400,
`WITHDRAWAL_CONSENT_REQUIRED`) sans `withdrawalConsent: true`. Mieux vaut ne pas vendre que
vendre un abonnement qu'on ne peut pas défendre.

### 3.2 La part fournie est bornée au quota

Les générations au-delà du quota mensuel ont été payées par des **crédits achetés séparément** —
un autre contrat. Les compter ferait passer le ratio au-dessus de 100 %, donc produirait un
remboursement négatif : une facture surprise, sur une opération censée rendre de l'argent.

`billable = min(used, quota)`.

### 3.3 Arrondi au centime, en faveur du consommateur

`Math.ceil`. Un arrondi qui tombe systématiquement du côté du professionnel est exactement le
détail qui transforme un litige évitable en plainte. Coût maximal : **un centime par
rétractation**.

### 3.4 Quota nul : pas de division par zéro

Si `quota ≤ 0` (plan à quota nul, ou synchronisation Stripe en retard qui n'a pas encore écrit
`quota_month`), rien n'a été fourni **au titre de l'abonnement** → remboursement intégral. Pas de
`NaN`, pas d'`Infinity`, pas de montant aberrant envoyé à l'API Stripe.

Même traitement pour un quota **non fini** : la part fournie d'un quota illimité tend vers zéro.
Le quota et la consommation pris en compte sont ceux **du contrat** (`subscriptions.quota_month`,
générations depuis `period_start`), pas ceux de `quotaState()` : pour un compte administrateur,
celui-ci renvoie un quota infini sans rapport avec l'abonnement payé, et le calcul sortait en
`NaN`. En dernier recours, `POST /withdrawal` refuse de journaliser ou d'envoyer à Stripe un
montant qui n'est pas un entier de centimes (erreur 500, rien n'est écrit).

### 3.5 Cas vérifiés

`backend/tests/prorata.test.js` — 15 cas, tous verts :

| Cas | Payé | Consommé | Remboursé | Conservé |
|---|---|---|---|---|
| Rien consommé | 24,90 € | 0 / 100 | **24,90 €** | 0 € |
| Le cas de l'énoncé | 24,90 € | 60 / 100 | **9,96 €** | 14,94 € |
| Quota épuisé | 24,90 € | 100 / 100 | **0 €** | 24,90 € |
| Dépassement par crédits | 24,90 € | 130 / 100 | **0 €** (jamais négatif) | 24,90 € |
| Quota nul | 9,90 € | 7 / 0 | **9,90 €** | 0 € |
| Sans consentement | 24,90 € | 95 / 100 | **24,90 €** | 0 € |
| Arrondi | 24,90 € | 37 / 100 | **15,69 €** (et non 15,68 €) | 9,21 € |

## 4. Les garde-fous — ce qui est licite, ce qui ne l'est pas

Un garde-fou licite **encadre** l'exercice du droit. Il ne le supprime jamais.

### 4.1 Le délai court depuis la CONCLUSION, pas depuis la période en cours

C'est l'invariant le plus important du chantier, et le plus coûteux s'il est raté.

`subscriptions.subscribed_at` est écrit **une seule fois par abonnement**, contrairement à
`period_start` qui avance à chaque prélèvement. Si les 14 jours partaient de `period_start`,
**chaque reconduction mensuelle rouvrirait une fenêtre de rétractation, à vie**.

Or une **reconduction tacite n'est pas un nouveau contrat à distance** : elle n'ouvre aucun droit
neuf. Même raisonnement pour un **changement de formule en cours de période** — c'est une
modification du contrat existant, pas une conclusion nouvelle. Ne pas rouvrir de délai à ce
moment-là est donc licite, parce que cela découle de la qualification du contrat et non d'une
clause qui retire un droit.

**Mais un réabonnement après résiliation est, lui, un contrat neuf**, avec son propre délai.
`upsertSubscription` compare donc l'identifiant d'abonnement : même `stripe_subscription_id` →
la date reste figée (`COALESCE`) ; identifiant différent → la date de conclusion du nouveau
contrat remplace l'ancienne. Une version précédente figeait la date **à vie** (une ligne par
utilisateur) : un client revenu trois mois plus tard était « hors délai » dès le jour de sa
souscription — précisément la restriction illicite que ce document s'emploie à éviter.

En mode démo, l'identifiant suit la même règle : un abonnement encore actif garde le sien (le
changement de formule le conserve), un réabonnement après résiliation en reçoit un neuf.

Testé : `withdrawal.test.js` → « une reconduction mensuelle ne rouvre PAS 14 jours » ;
`billing-withdrawal-guards.test.js` → changement de formule et reconduction sans nouveau délai,
réabonnement avec un nouvel identifiant → 14 jours.

### 4.2 Une seule rétractation automatique par fenêtre glissante — et ce qu'on en fait

`WITHDRAWAL_COOLDOWN_DAYS`, 365 jours par défaut (valeur non numérique, négative ou supérieure à
3 650 → repli sur 365 ; `0` désactive le garde-fou). Compte comme rétractation précédente toute
demande aboutie, en revue, **ou en échec dont le remboursement est parti** (`stripe_refund_id`
posé) : l'argent est sorti, peu importe l'étape qui a échoué ensuite.

**C'est le garde-fou le plus fragile juridiquement, et il faut être clair là-dessus** : le droit
de rétractation s'attache à *chaque* contrat conclu à distance. Refuser purement et simplement
une deuxième rétractation serait une restriction, donc illicite.

Ce qui est implémenté est différent : au-delà de la fenêtre, la demande **n'est pas refusée**,
elle est enregistrée avec le statut `review` et **sort du traitement automatique**. L'exploitant
la traite à la main dans le délai légal de remboursement de 14 jours. Cela lui donne le temps de
constater un éventuel abus de droit (souscrire/se rétracter tous les mois pour consommer
gratuitement) — qui, lui, est opposable — sans jamais opposer un refus de principe.

L'utilisateur en est prévenu **avant** de confirmer (`withdrawal.manualReview` sur l'encart).

### 4.3 Verrou de montant

Si le montant affiché ne correspond plus à l'état réel (des générations ont tourné pendant que
l'onglet était ouvert), la demande est refusée avec `AMOUNT_CHANGED` et le montant à jour. On ne
rembourse jamais un chiffre que l'utilisateur n'a pas vu.

### 4.4 Journalisation

Table `withdrawals` : le calcul y est **figé** (payé, quota, consommé, facturable, remboursé,
consentement invoqué, échéance, IP, identifiant de remboursement Stripe, contrat visé :
`stripe_subscription_id` ou `credit_purchase_id`). Il doit rester justifiable des années plus
tard, même si le prix, le quota ou la consommation changent entre temps. **L'exploitant peut
justifier chaque euro.**

### 4.5 Échec technique : traitement manuel, jamais un second remboursement

Une rétractation ratée techniquement reste une rétractation exercée : la demande passe en
`failed`, avec son calcul et son erreur, et l'exploitant la traite à la main dans les 14 jours.
Le risque est ailleurs : **rembourser deux fois**. Deux scénarios y mènent — le remboursement
passe puis la résiliation échoue, ou la réponse de Stripe se perd alors que le remboursement a
bien été créé — et dans les deux, l'encart reste affiché et l'utilisateur peut recliquer.

Deux protections :

- **Clé d'idempotence** sur `refunds.create`, dérivée du contrat (`withdraw:sub:<abonnement>`,
  `withdraw:pack:<achat>`) et non de la demande : pendant 24 h, un nouvel essai ne peut pas créer
  un second remboursement chez Stripe.
- **Au-delà, la base décide** : si une demande précédente sur **le même contrat** a déjà un
  identifiant de remboursement, est en `failed` ou est déjà en `review`, la nouvelle demande
  n'est **pas** exécutée automatiquement. Elle est enregistrée en `review` — exactement comme au
  §4.2 — et l'utilisateur en est prévenu avant de confirmer (`manualReview`). Ce n'est jamais un
  refus : le droit est exercé, seul le traitement change de mains.

Testé : `billing-withdrawal-guards.test.js` (remboursée, en échec, autre contrat, pack).

### 4.6 Compte supprimé

Un paiement peut arriver après la suppression du compte (paiement terminé dans un autre onglet,
event Stripe en retard). Le webhook lit `metadata.userId` avant tout filtre sur `deleted_at` ; il
vérifie donc explicitement l'état du compte : un abonnement non terminé d'un compte supprimé est
**résilié chez Stripe** et rien n'est provisionné ; un pack payé est **remboursé intégralement**
(rien à créditer sur une ligne pseudonymisée). Une facture d'abonnement déjà payée avant la
résiliation n'est pas remboursée automatiquement : l'événement
`billing.deleted_account_subscription_canceled` est journalisé pour traitement manuel.

## 5. Les packs de crédits — régime distinct, arbitrage rendu

**La question** : un pack de 20 générations à 6 € est un paiement unique. Est-ce un « contenu
numérique » (art. VI.53, 13° — le droit s'éteint dès la fourniture, avec consentement) ou un
service à fournir plus tard (le droit subsiste) ?

**La qualification est incertaine.** Un crédit n'est pas un contenu : c'est un droit de tirage
sur une prestation future. À ma connaissance la question n'est pas tranchée pour ce cas précis,
et je ne la tranche pas non plus.

**Arbitrage retenu — le pack est rétractable, au prorata des crédits NON consommés :**

```
remboursé = payé × (crédits encore en réserve / crédits vendus)
```

Justification : cette lecture est **plus favorable au consommateur que le minimum exigible**,
donc insensible à l'issue du débat de qualification. Et elle ne coûte rien à l'exploitant, parce
qu'elle ne rembourse que ce qui n'a pas été fourni : 5 crédits consommés sur 20 → il conserve
1,50 € pour environ 0,50 $ de coût réel d'API. **Le risque de perte est nul.**

Deux conséquences dans le code :
- fenêtre de 14 jours propre au pack, comptée depuis **son** achat (`credit_purchases.created_at`) —
  c'est un contrat distinct de l'abonnement, il vit sa propre vie ;
- les crédits étant fongibles (impossible de dire lequel vient de quel pack), on rembourse
  `min(crédits vendus par ce pack, crédits encore en réserve)` ;
- **pas pendant une génération** : un crédit n'est débité qu'à la *fin* d'une génération
  réussie. Rembourser pendant qu'elle tourne compterait comme « inutilisé » un crédit sur le
  point d'être consommé. Tant qu'une génération de l'utilisateur est `pending`, la demande est
  refusée avec `409 GENERATIONS_PENDING` (« réessayez dans quelques minutes »). Ce n'est pas un
  refus du droit, seulement un report de quelques minutes : une ligne `pending` plus ancienne
  qu'une heure (ou deux fois `N8N_TIMEOUT_MS`) est considérée orpheline — serveur arrêté en
  pleine génération — et ne bloque plus rien.
- l'achat est enregistré **dans une transaction** avec ses crédits, et les crédits ne sont
  ajoutés que si l'achat est nouveau (session Stripe déjà vue → rien) : un event rejoué ne
  crédite pas deux fois et n'ouvre pas deux droits de rétractation.

## 6. La dette rétroactive de 12 mois — et la bonne nouvelle

La revue juridique interne (non versionnée) §3.3 l'établit : **l'absence totale d'information sur la rétractation porte
le délai de 14 jours à 12 mois** (art. 10 de la directive). Pire, l'art. 14(4)(a) prévoit que
lorsque le professionnel a omis cette information, **le consommateur ne supporte aucun coût pour
le service exécuté pendant le délai** : le remboursement serait **intégral**, sans prorata.

**Formule de l'exposition théorique :**

```
exposition = Σ (sommes encaissées auprès de chaque abonné consommateur
                dont le contrat a moins de 12 mois)
```

**Le chiffre aujourd'hui est très probablement de 0 €**, et voici pourquoi :
`.env.example:96` porte `BILLING_ENABLED=false`, les quatre `STRIPE_PRICE_*` sont vides, et
`PASSATION.md` §4 range encore « Compte Stripe en sandbox… » dans les tâches **à faire**.
Autrement dit : **aucun euro n'a jamais été encaissé**. La dette est réelle en principe, mais son
montant actuel est nul.

**À vérifier sur la configuration de production** — ne pas se fier à ce document : si la
facturation n'y est pas activée et qu'aucune clé Stripe *live* n'y figure, l'exposition est de
0 € et il n'y a rien à faire ; si la facturation est active avec une clé *live*, appliquer le
§6.1 ci-dessous. Le tableau de bord Stripe (paiements encaissés en mode *live*) donne la même
réponse, et le montant exact de l'exposition.

### 6.1 Si des paiements ont eu lieu : comment refermer la fenêtre

L'art. 10(1) plafonne la sanction : **si l'information est fournie dans les 12 mois, le délai
expire 14 jours après que le consommateur l'a reçue.** Informer *ferme* donc le risque.

1. Déployer ce chantier (l'information est désormais sur `legal.html#retractation`).
2. **Envoyer un e-mail à chaque abonné existant** reprenant la clause de rétractation et le
   formulaire type, sur support durable. L'infrastructure SMTP existe (`backend/src/mail.js`).
3. Conserver la preuve de cet envoi. Quatorze jours plus tard, la fenêtre étendue est close pour
   tous, et le régime normal (14 jours + prorata) reprend.

**Cette étape n'est pas codée** : elle suppose un texte d'e-mail validé par l'exploitant et une
décision de sa part sur la formulation. C'est un point du §7.

## 7. Ce qui reste à décider — et qui n'est pas technique

| # | Point | Pourquoi ça bloque |
|---|---|---|
| 1 | **Consommateur ou professionnel ?** La clause 5.7 réserve le droit aux consommateurs, mais rien ne demande la qualité de l'acheteur à l'inscription. Aujourd'hui, **tout le monde** est traité en consommateur. | Ajouter un champ « j'achète à titre professionnel (n° BCE / TVA) » au paiement diviserait l'exposition. Décision commerciale (friction à l'achat) autant que juridique. |
| 2 | **TVA** : la revue juridique interne (non versionnée) §3.4 signale que les prix n'indiquent ni « TTC » ni « HTVA ». Le montant remboursé reprend le montant encaissé, donc il est cohérent quoi qu'il arrive — mais le **prix affiché** reste à trancher avec un comptable. | Hors périmètre de ce chantier, mais c'est le même parcours d'achat. |
| 3 | **Fenêtre anti-abus de 365 jours** (§4.2) : valeur par défaut, à ajuster via `WITHDRAWAL_COOLDOWN_DAYS`. | Arbitrage commercial. |
| 4 | **E-mail de confirmation sur support durable** reprenant la renonciation, après paiement. Obligation de l'art. 8(7). **Non codé.** | Demande un texte validé. Le SMTP existe déjà. |
| 5 | **Identité de l'éditeur** : `legal.html` §1 porte encore des `[À COMPLÉTER]`. Le formulaire type de rétractation renvoie à « [éditeur — voir section 1] ». | Sans l'adresse, le formulaire n'est pas utilisable. Bloquant avant toute vente. |

## 8. Ce qui a été codé

| Élément | Fichier |
|---|---|
| Calcul du prorata et éligibilité | `backend/src/billing/withdrawal.js` |
| Consentement exprès, aperçu, exécution | `backend/src/billing/routes.js` |
| Colonnes `withdrawal_consent_*` | `backend/src/db.js` |
| Tables `withdrawals`, `credit_purchases`, `subscriptions.subscribed_at` | `backend/src/billing/store.js` |
| Erreurs Stripe masquées au client (message générique, 502/503, jamais 401) | `backend/src/middleware/errors.js` |
| Encart d'éligibilité + modales | `frontend/js/tarifs.js`, `frontend/tarifs.html` |
| Clause + formulaire type (FR/EN/NL) | `frontend/legal.html` §5, `frontend/locales/*.json` |
| Tests | `backend/tests/prorata.test.js`, `backend/tests/withdrawal.test.js`, `backend/tests/billing-withdrawal-guards.test.js`, `backend/tests/billing-errors.test.js` |

### Le paiement à rembourser (API Stripe « basil »)

Depuis la version d'API `2025-03-31.basil`, une facture n'a plus de `payment_intent` : ses
paiements sont dans `invoice.payments`, **qui n'est renvoyé que s'il est expansé**. La
rétractation d'abonnement relit donc l'abonnement avec `expand: ['latest_invoice.payments']` et
retient l'entrée de type `payment_intent` au statut `paid`. Faute de paiement trouvé, rien n'est
remboursé au hasard : la demande passe en `failed` pour traitement manuel (§4.5).

### Le consentement : où il est stocké, et pourquoi pas chez Stripe

Stripe Checkout propose `consent_collection`, mais **uniquement** pour les CGU
(`terms_of_service`) et les promotions : il n'existe pas de type « renonciation à la
rétractation ». Et même s'il existait, l'accusé vivrait chez Stripe alors que **le prorata se
calcule ici** — il faudrait un appel API pour justifier chaque remboursement.

Choix retenu : **écriture en base avant la redirection** (`users.withdrawal_consent_at`,
`_version`, `_ip`), doublée d'un rappel visuel sur la page de paiement via `custom_text.submit`.

Écrit **avant** et non au retour : si le consentement était écrit au retour de Checkout, un
abandon de panier suivi d'un paiement par un autre chemin laisserait un abonnement payé sans
trace de consentement — donc remboursable à 100 %. Écrit trop tôt, il est au pire inutile.

La **version du texte** est conservée (`WITHDRAWAL_CONSENT_VERSION`) : une trace de consentement
sans version ne prouve pas ce qui a été accepté, donc ne prouve rien.

## 9. Procédure de recette

```bash
cd backend && npm install
npm test                      # toute la suite : prorata, rétractation, suppression, 404
node --test tests/prorata.test.js      # le seul calcul qui produit un virement réel
node --test tests/withdrawal.test.js tests/billing-withdrawal-guards.test.js tests/billing-errors.test.js
```

Parcours manuel en mode démo (aucune clé Stripe, rien n'est facturé) :

```bash
cd backend
DATA_DIR=/tmp/recette PORT=3000 SESSION_SECRET=$(openssl rand -hex 48) \
N8N_TOKEN=$(openssl rand -hex 24) BILLING_ENABLED=true EMAIL_VERIFICATION=false \
npm start
# → http://localhost:3000/tarifs.html : créer un compte, souscrire (la case de
#   consentement est obligatoire), puis l'encart de rétractation apparaît avec
#   le montant exact.
```
