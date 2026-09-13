# Déployer la version « sécurité + prompts » du 13 septembre 2026 sur le VPS

Cette version change le démarrage du backend (secrets obligatoires), l'utilisateur du conteneur (non-root), le workflow n8n (3 nodes Code + Respond) et la config nginx (CSP). À suivre dans l'ordre ; chaque étape est vérifiable.

## 1. Secrets et `.env` (sur le VPS, `/opt/ad-generator/.env`)

```bash
cd /opt/ad-generator
cp .env .env.bak.$(date +%F)
# nouveaux secrets
SESSION_SECRET=$(openssl rand -hex 48); N8N_TOKEN=$(openssl rand -hex 32)
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" .env
sed -i "s|^N8N_TOKEN=.*|N8N_TOKEN=$N8N_TOKEN|" .env
cat >> .env <<EOF
APP_ORIGINS=https://ads.devwork.cloud
REGISTER_MODE=open
FREE_PLAN_QUOTA=5
BILLING_ENABLED=true
SMTP_HOST=postfix
SMTP_PORT=25
SMTP_FROM=AdCraft <noreply@ads.devwork.cloud>
TERMS_VERSION=2026-09-13
GEMINI_MODEL=gemini-3.1-flash-image
GEMINI_IMAGE_SIZE=2K
GEN_PER_HOUR=20
GEN_PER_DAY=60
EOF
sed -i '/^COST_PER_IMAGE_USD=/d' .env        # le prix vient de la grille, plus d'une variable
echo "WEBHOOK_TOKEN à poser dans n8n : $N8N_TOKEN"
```

Mots de passe seed → hash (plus de clair dans `.env`) :
```bash
docker compose run --rm backend node -e "const b=require('bcryptjs');console.log('b64:'+Buffer.from(b.hashSync(process.argv[1],12)).toString('base64'))" 'NouveauMotDePasseRobuste'
# puis SEED_USERS=vdp.corentin@gmail.com:b64:...  (le compte existant n'est pas écrasé : ajouter SEED_FORCE_PASSWORD=true pour UN démarrage si tu veux changer le mot de passe)
```

**Révoquer la clé Gemini `AIza…`** présente dans le `.env` local (AI Studio → API keys) : elle n'est utilisée que par `tools/test-gemini.mjs`, jamais par la prod.

## 2. Données : le conteneur n'est plus root

```bash
sudo chown -R 1000:1000 /opt/ad-generator/backend/data
```

## 3. Code + build

```bash
git pull
cd backend && npm install nodemailer && cd ..   # vérification d'e-mail (met à jour package-lock.json)
chmod -R a+rX frontend
docker compose build backend            # contexte = racine (shared/ embarqué)
docker compose up -d backend
docker compose logs --tail=30 backend   # attendu : "Backend démarré … cookie __Host-sid, inscription open", aucun "✖"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health   # 200
```
Si le backend refuse de démarrer : le message dit quel secret manque.

## 4. nginx (hôte)

```bash
sudo cp nginx/snippets/adcraft-security.conf /etc/nginx/snippets/
sudo nano /etc/nginx/sites-available/ads.devwork.cloud
#   dans le bloc 443, après `root … ;` :   include snippets/adcraft-security.conf;
#   retirer les add_header X-Frame-Options / HSTS / nosniff / Referrer-Policy déjà présents (doublons)
#   dans location /api/ :  add_header Cache-Control "no-store" always;
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://ads.devwork.cloud/ | grep -i content-security-policy          # présent
curl -s -o /dev/null -w '%{http_code}\n' https://ads.devwork.cloud/package.json  # 404
curl -s -o /dev/null -w '%{http_code}\n' https://ads.devwork.cloud/robots.txt    # 200
```

## 5. n8n

Variables d'environnement de n8n (systemd ou conteneur), puis redémarrage :
```
WEBHOOK_TOKEN=<valeur de N8N_TOKEN>
GEMINI_MODEL=gemini-3.1-flash-image
GEMINI_IMAGE_SIZE=2K
GEMINI_TEXT_MODEL=gemini-2.5-flash
```
Workflow : le plus simple est d'**importer** `n8n/generateur-publicite.json` en nouveau workflow, de sélectionner la credential Google sur les deux nodes HTTP, d'activer, et de désactiver l'ancien. Si tu préfères patcher node par node (méthode JOURNALPROJET) : remplacer le `jsCode` de **Build DA Request**, **Build Prompt**, **Extract Image**, le `responseBody` de **Respond**, le timeout de **Directeur Artistique** (45000) et les URLs des deux nodes HTTP (défaut `gemini-3.1-flash-image`). Tout est dans le JSON généré.

## 6. Vérification fonctionnelle

1. Connexion → modale « Mentions légales et CGU » (une fois) → studio ; le pied du panneau affiche « ≈ 0,093 € par visuel (gemini-3.1-flash-image 2K) ».
2. Génération **Sport** avec une canette : arène, pas de vestiaire.
3. Génération avec **2 photos de produits différents** : les deux dans le visuel ; en base :
   ```bash
   docker compose exec backend node -e "const D=require('better-sqlite3');const db=new D('/app/data/app.db');console.log(db.prepare('SELECT id,status,art_direction_source,product_count,model,image_size,cost_usd FROM generations ORDER BY id DESC LIMIT 3').all())"
   ```
   attendu : `art_direction_source=auto`, `model=gemini-3.1-flash-image`, `image_size=2K`, `cost_usd=0.101`.
4. Corriger l'historique déjà enregistré à 0.134 (cf. `docs/MODELES.md`).
5. Accueil connecté : la barre montre Studio / Historique / conso / déconnexion (plus de bouton « Se connecter »).
6. Inscription avec une adresse réelle : l'e-mail arrive (vérifier les indésirables), le lien active le compte, le bandeau rouge disparaît. Le conteneur backend doit être sur le réseau `mail-shared-network` pour joindre `postfix` par son nom. Sans SPF/DKIM/DMARC sur le domaine expéditeur, l'e-mail part en indésirables.

## 7. Nettoyage

Les PNG lourds de `frontend/img/site/*.png|jpg` (10 Mo) ne sont plus référencés (remplacés par `.webp`, 600 Ko) : `git rm frontend/img/site/*.png frontend/img/site/*.jpg` sauf `og-image.jpg`. Supprimer aussi `frontend/_tmp_shots/` et le `frontend/node_modules/` du VPS s'il existe.

## 8. legal.html

Compléter les zones surlignées (identité de l'éditeur, adresse, BCE, hébergeur, e-mail de contact) avant de communiquer l'URL.
