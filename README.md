# 🎨 Générateur de Publicités IA avec N8N

> Automatisation complète de génération de publicités : de l'upload d'images à la livraison par email, 100% automatisé avec IA locale.

[![N8N](https://img.shields.io/badge/N8N-Automation-EA4B71?style=for-the-badge&logo=n8n)](https://n8n.io)
[![Ollama](https://img.shields.io/badge/Ollama-Local_AI-000000?style=for-the-badge)](https://ollama.ai)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

## 📋 Table des matières

- [Vue d'ensemble](#-vue-densemble)
- [Fonctionnalités](#-fonctionnalités)
- [Architecture](#-architecture)
- [Prérequis](#-prérequis)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Utilisation](#-utilisation)
- [API et Intégrations](#-api-et-intégrations)
- [Exemples](#-exemples)
- [Troubleshooting](#-troubleshooting)
- [Contribution](#-contribution)
- [License](#-license)

## 🎯 Vue d'ensemble

Ce projet permet de **générer automatiquement des publicités créatives** à partir de simples photos de produits. L'utilisateur upload ses images via une page web, et reçoit par email des visuels publicitaires professionnels générés par IA.

### Workflow complet

```
📸 Upload Image → 🤖 Analyse IA → 🎨 Génération Visuelle → 📧 Envoi Email
```

**Temps pour la génération encore à estimé car dépend du model et de la machine**

## ✨ Fonctionnalités

### 🔥 Principales

- ✅ **Upload multi-images** via interface web intuitive
- 🧠 **Analyse IA locale** avec Ollama (gratuit, privé)
- 🎨 **Génération de 3 variantes** publicitaires par image
- 📧 **Email automatique** avec visuels HD et concepts
- 🔒 **100% local** - vos données restent sur vos serveurs
- 🚀 **Sans limites** - pas de rate limiting API

### 🛠️ Techniques

- Validation des images via CTA spécifique
- Extraction automatique de l'email utilisateur
- Prompts optimisés pour l'analyse marketing
- Templates email HTML responsive
- Gestion d'erreurs complète
- Support multi-formats (JPG, PNG, WebP)

## 🏗️ Architecture

```
┌─────────────────┐
│   Page Web      │
│   + Upload      │
└────────┬────────┘
         │ POST /webhook
         ▼
┌─────────────────┐
│   N8N Webhook   │
│   (Validation)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Ollama Vision  │
│  (llama3.2)     │
└────────┬────────┘
         │ JSON Analysis
         ▼
┌─────────────────┐
│  Laozhang API   │
│  (Image Gen)    │
└────────┬────────┘
         │ 3 images
         ▼
┌─────────────────┐
│  Email Service  │
│  (Gmail/SMTP)   │
└─────────────────┘
```

## 📦 Installation

### 1️⃣ Clone du repository

```bash
git clone https://github.com/votre-username/ai-ad-generator.git
cd ai-ad-generator
```

### 2️⃣ Installation de N8N

```bash
# Installation globale
npm install -g n8n

# Ou avec Docker
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n
```

### 3️⃣ Installation d'Ollama

Suivez le guide officiel : **[ollama.com/download](https://ollama.com/download)**

Puis installez le modèle vision :
```bash
ollama pull llama3.2-vision
```

### 4️⃣ Import du workflow N8N

1. Démarrez N8N : `n8n start`
2. Ouvrez `http://localhost:5678`
3. Menu (☰) → **Import from File**
4. Sélectionnez `n8n-workflow.json`
5. Cliquez sur **Import**

## ⚙️ Configuration

### Variables d'environnement

Créez un fichier `.env` :

```env
# N8N
N8N_HOST=localhost
N8N_PORT=5678
N8N_PROTOCOL=http

# Ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2-vision

# Laozhang
LAOZHANG_API_URL=https://api.laozhang.ai/v1/generate
LAOZHANG_API_KEY=votre_cle_api_laozhang

# Email
EMAIL_SERVICE=gmail
EMAIL_USER=votre.email@gmail.com
EMAIL_FROM=Générateur Publicités <votre.email@gmail.com>
```

### Configuration N8N

#### 1. Credentials Laozhang

- Node "Laozhang Generation" → Credentials
- Type : HTTP Header Auth
- Header : `Authorization`
- Value : `Bearer VOTRE_CLE_API`

#### 2. Credentials Email

**Option A - Gmail OAuth2 :**
```
1. Google Cloud Console → Créer un projet
2. Activer Gmail API
3. Créer OAuth 2.0 credentials
4. N8N → Credentials → Gmail OAuth2
5. Suivre le flow d'authentification
```

**Option B - SMTP :**
```
Host: smtp.gmail.com
Port: 587
Username: votre.email@gmail.com
Password: app_password (pas votre mot de passe normal)
```

#### 3. Webhook URL

Une fois le workflow activé, votre webhook sera :
```
http://localhost:5678/webhook/generate-ads
```

Pour un accès externe (optionnel) :
```bash
# Avec ngrok
ngrok http 5678

# URL publique temporaire
https://xxxx-xx-xx-xx-xx.ngrok.io/webhook/generate-ads
```

## 🚀 Utilisation

### Interface Web

1. **Déployez** le fichier `web/index.html` sur votre serveur
2. **Configurez** l'URL du webhook dans le JavaScript
3. Les utilisateurs peuvent :
   - Uploader leurs images produits
   - Entrer leur email
   - Cliquer sur "Générer mes publicités"
   - Recevoir les résultats par email

### Test manuel via API

```bash
curl -X POST http://localhost:5678/webhook/generate-ads \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "ctaClicked": true,
    "images": [{
      "data": "BASE64_IMAGE_DATA",
      "name": "produit.jpg",
      "source": "cta_upload"
    }]
  }'
```

### Test avec l'interface de test Ollama

```bash
# Ouvrez test-ollama.html dans votre navigateur
# Glissez une image
# Testez l'analyse avant d'envoyer au workflow complet
```

## 🔌 API et Intégrations

### Format de réponse Ollama

```json
{
  "productDescription": "Montre de luxe en acier inoxydable",
  "adTheme": "lifestyle premium",
  "tagline": "Le temps est votre plus bel accessoire",
  "visualConcept": "Mise en scène minimaliste sur fond noir...",
  "colorPalette": "Noir profond, argent métallique, touches d'or",
  "laozahangPrompt": "Luxury watch advertisement, professional product photography..."
}
```

### Webhooks disponibles

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/webhook/generate-ads` | POST | Upload et génération complète |
| `/webhook/status` | GET | Statut du système |

### Intégrations futures

- [ ] Zapier connector
- [ ] Shopify plugin
- [ ] WordPress widget
- [ ] API REST publique

## 📸 Exemples

### Entrée : Photo produit
![Exemple entrée](docs/images/input-example.jpg)

### Sortie : Email reçu
![Exemple email](docs/images/email-example.jpg)

### Visuels générés
| Variante 1 | Variante 2 | Variante 3 |
|------------|------------|------------|
| ![Pub 1](docs/images/ad1.jpg) | ![Pub 2](docs/images/ad2.jpg) | ![Pub 3](docs/images/ad3.jpg) |

## 🐛 Troubleshooting

### Ollama ne démarre pas

```bash
# Vérifier le service
ollama serve

# Tester la connexion
curl http://localhost:11434/api/version
```

### Erreur "Model not found"

```bash
# Lister les modèles installés
ollama list

# Réinstaller le modèle
ollama pull llama3.2-vision
```

### Webhook N8N ne répond pas

1. Vérifiez que N8N tourne : `http://localhost:5678`
2. Activez le workflow (toggle en haut à droite)
3. Testez avec le bouton "Test workflow"

### Images non générées par Laozhang

- Vérifiez votre clé API
- Consultez les logs N8N
- Testez l'API directement :

```bash
curl -X POST https://api.laozhang.ai/v1/generate \
  -H "Authorization: Bearer VOTRE_CLE" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test", "num_images": 1}'
```

### Email non reçu

- Vérifiez les spams
- Testez les credentials email dans N8N
- Consultez les logs d'exécution du workflow
  
## 📄 License

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 👥 Auteurs

- Tigrou - *Développement initial*

## 🙏 Remerciements

- [N8N](https://n8n.io) - Plateforme d'automatisation
- [Ollama](https://ollama.ai) - IA locale
- [Laozhang](https://laozhang.ai) - Génération d'images -- **A vérifier si version local possible pour pas de dépendance**
- Communauté open-source

## 📞 Support

- **Issues** : [GitHub Issues](https://github.com/votre-username/ai-ad-generator/issues)
- **Discussions** : [GitHub Discussions](https://github.com/votre-username/ai-ad-generator/discussions)
- **Email** : vdp.corentin@gmail.com
---

<div align="center">

**⭐ Si ce projet vous aide, n'hésitez pas à lui donner une étoile !**

Made with ❤️ and 🤖

</div>
