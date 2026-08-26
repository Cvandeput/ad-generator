# Générateur de Publicités IA

Application web avec comptes utilisateurs pour générer des visuels publicitaires produit. L'utilisateur dépose des photos d'un produit, renseigne **marque / catégorie / goût**, choisit un **thème**, et reçoit une publicité générée par **Nano Banana Pro** (Google Gemini image), récupérable dans son **historique** avec téléchargement direct.

```
📸 Photos produit + infos (marque/catégorie/goût) + thème
        │
        ▼  (front → backend Express)
🔀 n8n : construit le prompt (base + preset thème + infos) → appelle Nano Banana Pro
        │
        ▼
🖼️ Image générée → stockée dans le compte → historique + téléchargement
```

## Architecture

```
Navigateur (front statique, Tailwind)
   │ HTTPS
   ▼
nginx  →  sert le front, TLS, proxy /api → backend
   │
   ▼
Backend Node/Express + SQLite
   - Auth (register/login, sessions, bcrypt)
   - Historique par compte, stockage images (data/)
   - Proxy vers n8n (ne voit jamais la clé Gemini)
   │ POST webhook (images base64 + brand/category/flavor/theme)
   ▼
n8n  →  build prompt + appel Gemini (Nano Banana Pro) + renvoi image
```

Le flux est **synchrone** : le backend attend la réponse de n8n (timeout ~120 s), écrit l'image et l'ajoute à l'historique.

## Composants

| Rôle | Choix |
|---|---|
| Front | HTML + Tailwind (CDN) + vanilla JS — `frontend/` |
| Backend | Node/Express + SQLite (better-sqlite3) — `backend/` |
| Orchestration | n8n — `n8n/generateur-publicite.json` |
| Génération image | Nano Banana Pro = `gemini-3-pro-image-preview` |
| Reverse proxy / TLS | nginx + Let's Encrypt — `nginx/` |

## Modèle & coût

Nano Banana Pro (`gemini-3-pro-image-preview`) : meilleur rendu texte/logo et jusqu'à 14 images de référence — idéal pour conserver le packaging d'une marque.

| Résolution | Prix / image |
|---|---|
| 1K / 2K | ~$0.134 |
| 4K | ~$0.24 |

À faible volume (~8-15 images/mois), ça reste sous ~1-2 €/mois. La résolution est fixée à `1K` dans le node **Build Prompt** (`imageConfig.imageSize`) — modifiable.

> Alternative moins chère : Nano Banana 2 (`gemini-3.1-flash-image-preview`, ~$0.067 @1K). Remplacer l'URL du node HTTP dans le workflow n8n.

## Prérequis

- Docker + Docker Compose (déploiement) **ou** Node.js 18+ et n8n en local (dev)
- Une **clé API Google Gemini** — [Google AI Studio](https://aistudio.google.com/apikey)
- (Prod) un domaine pointant sur le serveur, pour le TLS

## Installation (Docker, recommandé)

```bash
git clone https://github.com/Cvandeput/ad-generator.git
cd ad-generator

cp .env.example .env
# Éditer .env : SESSION_SECRET (aléatoire), N8N_TOKEN (aléatoire), DOMAIN

docker compose up -d --build
```

Puis configurer n8n (une seule fois) :

1. Ouvrir `http://localhost:5678`, créer le compte owner n8n.
2. **Credentials → New → Header Auth** : Name = `x-goog-api-key`, Value = *votre clé Gemini*. Nommer la credential `Gemini API Key (x-goog-api-key)`.
3. **Workflows → Import from File** → `n8n/generateur-publicite.json`.
4. Sur le node **Nano Banana Pro**, sélectionner la credential créée à l'étape 2.
5. **Activer** le workflow (toggle en haut à droite).

L'app est servie par nginx sur `http://localhost` (port 80).

### TLS en production

```bash
# Obtenir le certificat (adapter le domaine), puis décommenter le bloc HTTPS
# dans nginx/default.conf et le volume certbot dans docker-compose.yml.
certbot certonly --webroot -w ./frontend -d votre-domaine.tld
docker compose restart nginx
```

## Installation (dev local, sans Docker)

```bash
# n8n
npx n8n            # http://localhost:5678  (configurer credential + importer workflow)

# backend
cd backend
npm install
# .env à la racine : N8N_WEBHOOK_URL=http://localhost:5678/webhook/generate-ads
npm run dev        # http://localhost:3000
```

Ouvrir `http://localhost:3000` → page de connexion.

## Utilisation

1. **S'inscrire** puis se connecter.
2. **Déposer** une ou plusieurs photos du même produit (max 14).
3. Renseigner **Marque**, **Catégorie** (ex. « boisson énergisante »), **Goût** (optionnel).
4. Choisir un **thème** : Classique · Été · Nouveau/Extravagant · Sport/Énergie · Nuit/Fête · Luxe/Premium · Noël/Hiver.
5. **Générer** → l'image s'affiche et apparaît dans l'historique.
6. **Télécharger** depuis le résultat ou l'historique.

Exemple : `Red Bull` · `boisson énergisante` · `pêche` · thème *Néon*.

## Thèmes / presets

Les presets de prompt vivent dans le node **Build Prompt** du workflow n8n (objet `PRESETS`). Pour ajouter/ajuster un thème : éditer cet objet **et** ajouter le bouton correspondant dans `frontend/app.html` + la clé dans `THEMES` de `backend/src/routes/generate.js`.

## API backend

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Créer un compte |
| POST | `/api/auth/login` | Connexion |
| POST | `/api/auth/logout` | Déconnexion |
| GET | `/api/auth/me` | Utilisateur courant |
| POST | `/api/generate` | Générer (multipart : `images[]`, `brand`, `category`, `flavor`, `theme`) |
| GET | `/api/history` | Historique du compte |
| GET | `/api/image/:id` | Image générée (`?download=1` pour forcer le téléchargement) |

## Sécurité

- Clé Gemini **uniquement** dans n8n (credential), jamais dans le repo ni le front.
- Mots de passe hachés (bcrypt), cookie de session `httpOnly` + `secure` (prod) + `sameSite`.
- Rate-limit sur l'auth et la génération, en-têtes helmet + nginx.
- Webhook n8n protégé par token partagé (`N8N_TOKEN`).
- `.env` et `backend/data/` sont gitignorés.

## Structure

```
backend/     Express + SQLite (auth, historique, proxy n8n)
frontend/    login.html, app.html, js/
n8n/         generateur-publicite.json (workflow)
nginx/       default.conf (proxy + TLS)
docs/images/ exemples avant/après
docker-compose.yml, .env.example
```

## Dépannage

- **502 à la génération** → workflow n8n non activé, credential Gemini absente, ou clé invalide. Voir les exécutions dans l'UI n8n.
- **Délai dépassé** → augmenter `N8N_TIMEOUT_MS` et le `timeout` du node HTTP.
- **Cookie non conservé en prod** → `NODE_ENV=production` requis (cookie `secure`) + accès en HTTPS.
- **`Gemini: aucune image renvoyée`** → vérifier `responseModalities: ['Image']` et le modèle dans le node HTTP.

## Auteur

**Vandeput Corentin** — [devworks.be](https://devworks.be) · vdp.corentin@gmail.com

## License

MIT
