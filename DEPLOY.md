> **OBSOLETE — ne pas suivre tel quel sur le VPS de prod.**
> Ce document decrit l'installation d'origine (nginx en conteneur, certbot dockerise,
> import du workflow n8n). L'infra reelle a diverge : nginx tourne sur l'hote et le
> workflow n8n se patche node par node. Voir `JOURNALPROJET.md` et `UPDATE-VPS.md`.
> Appliquer les etapes 1, 5 et 6 d'ici coupe le site.

# Déploiement sur VPS (Docker Compose + n8n existant + TLS)

Objectif : mettre le site en ligne sur ton VPS, en réutilisant ton **n8n déjà installé**.
Le backend + nginx tournent en Docker Compose ; n8n reste tel quel et reçoit le webhook.

> Remplace partout `TON-DOMAINE.TLD` par ton vrai domaine, et vérifie que son DNS (A record) pointe sur l'IP du VPS.

---

## 0. Diagnostic (SSH sur le VPS)

```bash
grep PRETTY_NAME /etc/os-release
docker --version; docker compose version
docker ps --format '{{.Names}} | {{.Image}} | {{.Ports}}' | grep -i n8n   # n8n en conteneur ?
systemctl is-active n8n 2>/dev/null                                        # n8n en service ?
ss -tlnp | grep 5678                                                       # qui écoute 5678
```
Note **comment tourne n8n** (conteneur vs systemd) → détermine les variables d'env à poser (étape 4).

Si Docker absent : `curl -fsSL https://get.docker.com | sh`

---

## 1. Récupérer le projet sur le VPS

```bash
git clone https://github.com/Cvandeput/ad-generator.git
cd ad-generator
```
(ou `scp` le dossier. `.env`, `sa-key.json`, `progresse.md`, `test/` ne sont pas dans git → à copier à part / recréer.)

---

## 2. Créer `.env` (racine, sur le VPS)

```bash
cat > .env <<'EOF'
NODE_ENV=production
PORT=3000

# n8n existant, joignable depuis le conteneur backend :
N8N_WEBHOOK_URL=http://host.docker.internal:5678/webhook/generate-ads
N8N_TOKEN=METS_UN_TOKEN_ROBUSTE_ICI
N8N_TIMEOUT_MS=120000

# Suivi conso (aligner au modèle n8n)
COST_PER_IMAGE_USD=0.039
USD_TO_EUR=0.92

# Comptes (login only)
SEED_USERS=vdp.corentin@gmail.com:UN_MDP_ROBUSTE,daronne@email.com:AUTRE_MDP

# Session
SESSION_SECRET=COLLER_UNE_CHAINE_ALEATOIRE
DOMAIN=TON-DOMAINE.TLD
EOF
```
Générer des secrets : `openssl rand -hex 48` (pour SESSION_SECRET et N8N_TOKEN).

> Si ton n8n est un **conteneur** et que `host.docker.internal` ne marche pas, mets plutôt l'IP de la passerelle Docker (souvent `http://172.17.0.1:5678/webhook/generate-ads`) ou branche le backend sur le même réseau Docker que n8n.

---

## 3. Copier la clé service account

Mets `sa-key.json` à la racine du projet sur le VPS (utile pour copier son contenu dans n8n).
```bash
# depuis ton PC :
scp sa-key.json user@VPS:~/ad-generator/sa-key.json
```

---

## 4. Configurer n8n

**a) Variables d'env de n8n** (là où n8n tourne) :
- `GCP_PROJECT=gen-lang-client-0152004313`
- `WEBHOOK_TOKEN=` (la MÊME valeur que `N8N_TOKEN` du `.env`)
- `GEMINI_MODEL=gemini-2.5-flash-image` (optionnel, défaut)

Selon le cas :
- n8n en **Docker** : ajoute ces `-e VAR=...` / `environment:` au conteneur n8n, puis recrée-le.
- n8n en **systemd** : ajoute-les dans le fichier d'environnement du service (`Environment=...` ou `EnvironmentFile=`), puis `systemctl restart n8n`.

**b) Credential Google** (UI n8n) :
Credentials → New → **Google Service Account (googleApi)** →
- *Service Account Email* = champ `client_email` de `sa-key.json`
- *Private Key* = champ `private_key` de `sa-key.json` (tout le bloc `-----BEGIN...`)
- Scope : `https://www.googleapis.com/auth/cloud-platform`

**c) Importer le workflow** : Workflows → Import from File → `n8n/generateur-publicite.json` →
sur le node **Nano Banana (Vertex)** sélectionne la credential créée → **Activer** le workflow.

---

## 5. TLS (Let's Encrypt)

```bash
mkdir -p certbot/www certbot/conf
docker compose up -d --build          # démarre backend + nginx (HTTP)

# Obtenir le certificat (webroot) :
docker run --rm \
  -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d TON-DOMAINE.TLD --email vdp.corentin@gmail.com --agree-tos --no-eff-email

# Activer la conf HTTPS :
sed -i 's/TON-DOMAINE.TLD/ton-domaine-reel.tld/g' nginx/ssl.conf
cp nginx/ssl.conf nginx/default.conf
docker compose restart nginx
```
Renouvellement (cron mensuel) :
```bash
docker run --rm -v "$(pwd)/certbot/conf:/etc/letsencrypt" -v "$(pwd)/certbot/www:/var/www/certbot" certbot/certbot renew && docker compose restart nginx
```

---

## 6. Vérifier

1. `https://TON-DOMAINE.TLD` → page login.
2. Connexion avec un compte de `SEED_USERS`.
3. Upload image + infos + thème → **Générer** → image + historique + conso.
4. Si erreur : `docker compose logs -f backend`, et l'onglet **Executions** de n8n.

## 7. Maintenance

**Purge des générations en échec** (lignes `status='error'` + fichiers orphelins de `outputs/`) :
```bash
docker compose exec backend node tools/purge-errors.js          # dry-run : liste, ne supprime rien
docker compose exec backend node tools/purge-errors.js --yes    # suppression réelle
```

**CSS (Tailwind)** : le front ne charge plus Tailwind via CDN ; `frontend/css/app.css`
est **buildé et versionné** (nginx le sert tel quel, aucun rebuild au déploiement).
À régénérer uniquement si tu changes des classes Tailwind dans le HTML/JS :
```bash
cd frontend && npm install && npm run build:css   # met à jour frontend/css/app.css (à committer)
```

## Dépannage
- **502 à la génération** → backend n'atteint pas n8n. Vérifie `N8N_WEBHOOK_URL` (host.docker.internal vs IP), workflow **activé**, token identique des deux côtés.
- **401 Vertex** dans n8n → scope credential manquant (`cloud-platform`) ou API Vertex non activée sur le projet.
- **429** → quota Vertex ; demande une hausse (Cloud Console → IAM & Admin → Quotas).
- **Cookie pas gardé** → il faut `NODE_ENV=production` + accès en **HTTPS** (cookie secure). En dev local sans TLS avec `NODE_ENV=production`, poser `SESSION_COOKIE_SECURE=false`.
- **Page nue / styles manquants** → `frontend/css/app.css` absent ou non buildé (voir §7).
