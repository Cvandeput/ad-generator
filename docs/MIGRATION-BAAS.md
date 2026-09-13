# Migration vers un backend « style Supabase » auto-hébergé — étapes

_13 septembre 2026._

## Mise au point

Ce qui est remplacé n'est **pas nginx**. nginx est le reverse proxy TLS devant tout (et il restera devant le nouveau backend, c'est d'ailleurs la configuration recommandée par PocketBase). Ce qui est remplacé, c'est la **couche auth + base + fichiers** faite maison dans Express (`express-session` + SQLite + `bcryptjs` + `multer`), par un BaaS open source qui fournit auth, base, stockage de fichiers, règles d'accès et console d'administration.

## Choix : PocketBase

Le « Supabase gratuit sans pause » que tu as vu, c'est ce qu'on obtient en **auto-hébergeant** : la pause après 7 jours d'inactivité est propre au plan gratuit de Supabase Cloud, pas au logiciel. Options auto-hébergeables comparées pour ton VPS (Hostinger, déjà n8n + nginx + Docker) :

| | PocketBase v0.40 | Appwrite | Supabase self-host | Nhost / Directus |
|---|---|---|---|---|
| Empreinte | **1 binaire Go, ~50 Mo RAM**, SQLite | ~10 conteneurs, 2–4 Go RAM | ~12 conteneurs, ≥ 4 Go RAM | Postgres + Hasura/Node, lourd |
| Auth | e-mail/mdp, OTP, **MFA**, OAuth2, règles de mot de passe, **rate limiter intégré**, verrouillage | complet | complet (GoTrue) | complet |
| Base | SQLite (comme aujourd'hui, migration triviale), règles d'accès par collection | MariaDB | Postgres + RLS | Postgres |
| Fichiers | stockage local ou S3, miniatures, URL protégées par règles | oui | oui (Storage) | oui |
| Logique serveur | **hooks JS** (`pb_hooks/*.pb.js`, routes custom, `$http.send`) ou Go | Functions (conteneurs) | Edge Functions (Deno) | Functions |
| Console admin | oui, intégrée | oui | oui (Studio) | oui |
| Coût / pause | 0 €, jamais de pause | 0 € | 0 € | 0 € |

Pour un outil sur invitation avec quelques comptes, une table `generations`, des images et un webhook n8n : **PocketBase**. Appwrite/Supabase self-host apportent Postgres et un écosystème plus large, au prix de 10 conteneurs à maintenir sur un VPS qui héberge déjà n8n. Si un jour il faut du SQL relationnel lourd ou des milliers d'utilisateurs, la migration PocketBase → Supabase reste possible (export JSON).

## Architecture cible

```
navigateur ──HTTPS──▶ nginx (hôte)
                       ├── /            → front statique (frontend/)
                       ├── /api/        → PocketBase :8090   (auth, collections, fichiers, hooks)
                       └── /_/          → console admin PocketBase (IP whitelist)
PocketBase ──hook JS (POST /api/adcraft/generate)──▶ n8n webhook ──▶ Vertex AI
```

Deux variantes pour la génération :

- **A (recommandée, étape 5)** : tout dans PocketBase. Le hook JS `generate` vérifie l'utilisateur, les quotas, appelle n8n, enregistre l'image dans la collection `generations`. **Le backend Express disparaît.**
- **B (transition)** : garder Express uniquement comme proxy de génération, qui valide le token PocketBase (`GET /api/collections/users/auth-refresh` avec l'`Authorization` reçu) puis fait ce qu'il fait aujourd'hui. Utile si les hooks JS bloquent sur un détail ; à supprimer ensuite.

## Étapes

### 0. Prérequis (VPS)

```bash
ssh vps
mkdir -p /opt/pocketbase && cd /opt/pocketbase
PB_VERSION=0.40.4    # vérifier la dernière : https://github.com/pocketbase/pocketbase/releases
curl -L -o pb.zip https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip
unzip pb.zip && rm pb.zip && chmod +x pocketbase
./pocketbase --version
```

### 1. Service systemd + chiffrement des secrets

```bash
openssl rand -hex 16 > /opt/pocketbase/.enc && chmod 600 /opt/pocketbase/.enc   # 32 caractères
cat > /etc/systemd/system/pocketbase.service <<'EOF'
[Unit]
Description=PocketBase (AdCraft)
After=network.target

[Service]
Type=simple
User=pocketbase
Group=pocketbase
LimitNOFILE=4096
Restart=always
RestartSec=5s
Environment=GOMEMLIMIT=512MiB
EnvironmentFile=/opt/pocketbase/.env
WorkingDirectory=/opt/pocketbase
ExecStart=/opt/pocketbase/pocketbase serve --http=127.0.0.1:8090 --encryptionEnv=PB_ENCRYPTION_KEY --dir=/opt/pocketbase/pb_data --hooksDir=/opt/pocketbase/pb_hooks

[Install]
WantedBy=multi-user.target
EOF
useradd -r -s /usr/sbin/nologin pocketbase
echo "PB_ENCRYPTION_KEY=$(cat /opt/pocketbase/.enc)" > /opt/pocketbase/.env
echo "N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/generate-ads" >> /opt/pocketbase/.env
echo "N8N_TOKEN=$(openssl rand -hex 32)" >> /opt/pocketbase/.env      # même valeur dans WEBHOOK_TOKEN de n8n
chown -R pocketbase:pocketbase /opt/pocketbase && chmod 600 /opt/pocketbase/.env
systemctl daemon-reload && systemctl enable --now pocketbase
curl -s http://127.0.0.1:8090/api/health
```

Créer le superuser : `sudo -u pocketbase /opt/pocketbase/pocketbase superuser upsert toi@exemple.com 'MotDePasseLong' --dir=/opt/pocketbase/pb_data`, puis **restreindre l'IP** de la console : `pocketbase superuser ips 127.0.0.1 <ton IP>`. Activer la MFA du superuser dans la console (Settings → Auth).

### 2. nginx (hôte) — remplacer le `location /api/` actuel

```nginx
# /etc/nginx/sites-available/ads.devwork.cloud (bloc 443)
location /api/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 360s;
    client_max_body_size 150m;        # 14 photos × 10 Mo
    add_header Cache-Control "no-store" always;
}
location /_/ {                          # console admin
    allow <ton IP>; deny all;
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
}
```
`nginx -t && systemctl reload nginx`. Le snippet `nginx/snippets/adcraft-security.conf` (CSP, fichiers interdits) reste inclus.

### 3. Collections (console → Collections → New, ou import du schéma ci-dessous)

**`users`** (collection auth existante) :
- Options auth : identité = e-mail ; **Min password length = 12** ; « Only verified » ; désactiver l'inscription publique (règle `createRule` = `null`… voir étape 4) ; OAuth2 optionnel (Google) ; **MFA** optionnelle ; OTP e-mail pour la récupération de mot de passe (SMTP à configurer : Settings → Mail, par ex. le Postfix déjà utilisé sur BelleMontreWallone).
- Champs ajoutés : `terms_version` (text), `terms_accepted_at` (date), `invite_code_used` (text).
- Règles API : `listRule`/`viewRule` = `id = @request.auth.id`, `updateRule` = `id = @request.auth.id`, `deleteRule` = `id = @request.auth.id`.

**`generations`** (base) :
```
user              relation(users, single, cascade delete, required)
brand             text (max 60, required)
category          select [boisson, boisson énergisante, alcool, chips, snack, cosmétique, parfum, épicerie, autre]
flavor            text (max 60)
description       text (max 120)
art_direction     text (max 200)
theme             select [classique, ete, extravagant, sport, fete, luxe, noel] (required)
product_count     number (1–6)
inputs            file (multiple, max 14, 10 Mo, mime image/jpeg|png|webp, protected)
output            file (single, protected)
prompt_used       text
art_direction_source select [manual, auto, fallback]
model             text
image_size        text
cost_usd          number
status            select [pending, done, error] (required)
error             text
```
Règles : `listRule`/`viewRule`/`deleteRule` = `user = @request.auth.id` ; `createRule` = `null` et `updateRule` = `null` (seul le hook crée/modifie, jamais le client → impossible de forger `cost_usd` ou `status`).

**`invites`** (base, pour le mode invitation) : `code` (text, unique), `email` (email, optionnel), `used_by` (relation users), `expires` (date). Règles toutes à `null` (géré par hook).

Fichiers `protected` : les URLs exigent un **file token** (`pb.files.getToken()`), donc les images ne sont accessibles qu'à leur propriétaire — équivalent de l'actuel `/api/image/:id` avec contrôle de `user_id`.

### 4. Hooks JS (`/opt/pocketbase/pb_hooks/`)

`adcraft.pb.js` — inscription contrôlée, CGU, génération, quotas :

```js
/// <reference path="../pb_data/types.d.ts" />

// Inscription : seulement avec un code d'invitation valide + CGU acceptées + mot de passe robuste.
onRecordCreateRequest((e) => {
  const code = e.requestInfo().body.inviteCode || "";
  const accept = e.requestInfo().body.acceptTerms === true;
  if (!accept) throw new BadRequestError("Vous devez accepter les mentions légales");
  const invite = $app.findFirstRecordByFilter("invites", "code = {:c} && used_by = '' && (expires = '' || expires > @now)", { c: code });
  if (!invite) throw new ForbiddenError("Code d'invitation invalide");
  const pwd = e.requestInfo().body.password || "";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pwd)).length;
  if (pwd.length < 12 || classes < 3) throw new BadRequestError("Mot de passe : 12 caractères et 3 types minimum");
  e.record.set("terms_version", "2026-09-13");
  e.record.set("terms_accepted_at", new Date().toISOString());
  e.record.set("invite_code_used", code);
  e.next();
  invite.set("used_by", e.record.id); $app.save(invite);
}, "users");

// Génération : auth obligatoire, quotas par compte, appel n8n, enregistrement.
routerAdd("POST", "/api/adcraft/generate", (e) => {
  const auth = e.auth; if (!auth) throw new UnauthorizedError();
  const hour = new Date(Date.now() - 3600e3).toISOString().replace("T", " ");
  const n = $app.countRecords("generations", $dbx.exp("user = {:u} AND created > {:t}", { u: auth.id, t: hour }));
  if (n >= 20) throw new TooManyRequestsError("Quota horaire atteint");

  const info = e.requestInfo();
  const files = info.files["images"] || [];
  if (!files.length || files.length > 14) throw new BadRequestError("1 à 14 images");
  const rec = new Record($app.findCollectionByNameOrId("generations"));
  rec.set("user", auth.id); rec.set("status", "pending");
  for (const k of ["brand", "category", "flavor", "description", "art_direction", "theme", "product_count"]) rec.set(k, info.body[k]);
  rec.set("inputs", files);
  $app.save(rec);

  // Goja n'a ni Buffer ni btoa : on n'encode PAS en base64 ici. Les photos partent
  // en multipart (FormData + fichiers), et c'est le node Code de n8n qui les passe
  // en base64 ($input.first().binary) avant Vertex. Adapter le node Webhook n8n :
  // « Binary Property » activé.
  const form = new FormData();
  form.append("userId", auth.id);
  for (const k of ["brand", "category", "flavor", "description", "art_direction", "theme", "product_count"]) form.append(k, String(info.body[k] ?? ""));
  for (const f of files) form.append("images", f);
  const res = $http.send({
    url: $os.getenv("N8N_WEBHOOK_URL"), method: "POST", timeout: 150,
    headers: { "x-webhook-token": $os.getenv("N8N_TOKEN") },
    body: form,
  });
  if (res.statusCode !== 200 || !res.json.image) { rec.set("status", "error"); rec.set("error", "n8n " + res.statusCode); $app.save(rec); throw new ApiError(502, "Génération échouée"); }
  // n8n renvoie l'image en base64 : demander plutôt au node Respond de renvoyer le
  // binaire brut (Respond to Webhook → "Binary") et lire res.raw ; sinon décoder
  // côté n8n et écrire l'image dans un dossier partagé lu avec $filesystem.fileFromPath.
  const out = $filesystem.fileFromBytes(toBytes(res.raw), "output.png");
  rec.set("output", out); rec.set("status", "done"); rec.set("prompt_used", res.json.prompt);
  rec.set("model", res.json.model); rec.set("image_size", res.json.imageSize);
  rec.set("art_direction_source", res.json.artDirectionSource); rec.set("cost_usd", priceFor(res.json.model, res.json.imageSize));
  $app.save(rec);
  return e.json(200, { id: rec.id, status: "done", costUsd: rec.get("cost_usd") });
}, $apis.requireAuth());

function priceFor(model, size) { /* copier la grille de backend/src/pricing.js */ }
```
(Les hooks sont en Goja : pas de `npm`, mais `$http`, `$filesystem`, `$os`, `$app` couvrent tout ce qu'Express faisait. Documentation : pocketbase.io/docs/js-overview.)

### 5. Front — remplacer `frontend/js/api.js`

Le SDK JS de PocketBase (`pocketbase` sur npm, ou `/js/pocketbase.umd.js` auto-hébergé pour respecter la CSP `script-src 'self'`) remplace les appels `fetch` :

```js
import PocketBase from '/js/vendor/pocketbase.es.js';
export const pb = new PocketBase('/');           // même origine → cookies/CSP inchangés
pb.authStore.loadFromCookie(document.cookie);    // ou laisser en localStorage (défaut du SDK)

export const api = {
  login: (email, password) => pb.collection('users').authWithPassword(email, password),
  register: (p) => pb.collection('users').create({ email: p.email, password: p.password, passwordConfirm: p.password, inviteCode: p.inviteCode, acceptTerms: p.acceptTerms }),
  logout: () => pb.authStore.clear(),
  me: () => pb.authStore.isValid ? pb.collection('users').authRefresh() : Promise.reject(),
  generate: (fd) => pb.send('/api/adcraft/generate', { method: 'POST', body: fd }),
  history: () => pb.collection('generations').getList(1, 200, { filter: 'status = "done"', sort: '-created' }),
  remove: (id) => pb.collection('generations').delete(id),
  imageUrl: (rec) => pb.files.getURL(rec, rec.output, { token: fileToken }),   // fileToken = await pb.files.getToken()
};
```
Réponse à la question « lien copié dans un autre navigateur » dans ce modèle : le token vit dans `localStorage` (ou un cookie) du navigateur, jamais dans l'URL → même comportement qu'aujourd'hui. Les URLs de fichiers `protected` portent un token **court** (~2 min) : un lien d'image copié expire.

### 6. Migration des données

```bash
# export SQLite actuel → JSON, puis import via l'API admin (script node, une fois)
docker compose exec backend node -e "const D=require('better-sqlite3');const db=new D('/app/data/app.db');console.log(JSON.stringify({users:db.prepare('select * from users').all(),gens:db.prepare('select * from generations').all()}))" > export.json
```
Utilisateurs : recréer via l'API superuser (`POST /api/collections/users/records` avec `password` **connu** — bcrypt n'est pas importable, PocketBase re-hache) → prévenir les utilisateurs de choisir un nouveau mot de passe (ou envoyer un OTP de réinitialisation). Générations : `POST` par ligne avec `inputs`/`output` lus depuis `backend/data/uploads|outputs`.

### 7. Bascule

1. Déployer PocketBase (étapes 0–4), tester avec `curl -H "Authorization: <token>" https://ads.devwork.cloud/api/collections/generations/records`.
2. Déployer le front branché sur le SDK (étape 5) sur une URL de test (`/beta/`), valider une génération réelle.
3. Migrer les données (6), basculer nginx `/api/` vers 8090, arrêter le conteneur Express (`docker compose down`).
4. Sauvegardes : console → Settings → Backups (quotidien, vers S3 ou `/opt/pocketbase/backups` + rsync hors VPS).
5. Vérifs sécurité identiques au pentest : rate limiter activé (Settings → Application), `/_/` filtré par IP, MFA superuser, `client_max_body_size`, CSP.

### Estimation

Étapes 0–3 : une demi-journée. Hooks (4) : une journée avec les tests n8n. Front (5) : une demi-journée (les pages ne changent pas, seul `api.js` et l'URL des images). Migration + bascule : une demi-journée.

## Sources

- Production PocketBase (systemd, nginx, encryption, backups, rate limiter) : https://pocketbase.io/docs/going-to-production/
- Authentification PocketBase (mot de passe, OTP, MFA, OAuth2, tokens) : https://pocketbase.io/docs/authentication/
- Comparatifs auto-hébergés 2026 : https://selfhost.dev/blog/10-best-supabase-alternatives-in-2026-ranked/ · https://ossalt.com/guides/best-open-source-alternatives-to-supabase-2026
