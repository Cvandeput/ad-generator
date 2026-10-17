# Strix en local contre AdCraft — setup (voie B, 100% local)

But : faire tourner l'agent de pentest `usestrix/strix` sur la machine AMD
(RX 9060 XT 16 Go, 32 Go RAM) avec un LLM local, sans clé API payante.
Cible : **instance de test** d'AdCraft, jamais la prod sans snapshot.

> Attendu honnête : un 14B local raisonne bien moins qu'un modèle frontier.
> Strix trouvera les vulns évidentes, bâclera les chaînes complexes et bouclera
> parfois. C'est le prix du 100% local assumé.

## 1. Modèle local

Pick : **Qwen3 14B** (Q4_K_M) — ~9,3 Go de poids, badge *Tools* (tool-calling
natif), bon en code/raisonnement, laisse ~7 Go libres… tant que le contexte
reste court. Le pentest agentique a besoin de **contexte long** → il faut
monter `num_ctx`, ce qui mange la VRAM. Avec 16 K de contexte on tient à peu
près sur 16 Go ; au-delà (32 K) ça déborde en RAM via Vulkan = lent mais
fonctionnel.

Alternatives :
- plus léger / tu veux garder la VRAM : **Qwen3 8B** (~6-8 Go), agent correct, moins fin.
- Hermes 4 14B (finetune Qwen3-14B, tool-calls en `<tool_call>`) si Qwen3 déçoit.
- éviter Mistral Small 3.2 24B (déborde + bugs de tool-parser signalés sous Ollama).

```powershell
# Windows, Ollama déjà installé (backend Vulkan OK sur RX 9060 XT)
ollama pull qwen3:14b

# Contexte long + exposition au conteneur Docker de Strix :
setx OLLAMA_HOST "0.0.0.0:11434"     # Ollama doit écouter hors localhost
# relance Ollama après ce setx (quitter le tray + relancer), puis vérifie :
#   curl http://localhost:11434/v1/models
```

Contexte : crée un modèle dérivé à 16K pour ne pas dépendre du défaut (8K).
```powershell
@"
FROM qwen3:14b
PARAMETER num_ctx 16384
"@ | Out-File -Encoding ascii Modelfile.qwen3-16k
ollama create qwen3-14b-16k -f Modelfile.qwen3-16k
```

## 2. Strix

```powershell
# Prérequis : Docker Desktop lancé.
pipx install strix-agent    # ou: uv tool install strix-agent
```

Config — Strix parle à Ollama via son endpoint OpenAI-compatible. Strix tourne
dans Docker : pour joindre l'Ollama de l'hôte Windows, c'est
`host.docker.internal`, **pas** `localhost`.

```powershell
$env:STRIX_LLM      = "openai/qwen3-14b-16k"
$env:LLM_API_BASE   = "http://host.docker.internal:11434/v1"
$env:LLM_API_KEY    = "ollama"          # dummy, Ollama ignore la clé
```

Gotchas :
- `localhost` dans Strix = le conteneur, pas ta machine → utilise `host.docker.internal`.
- si `host.docker.internal` ne résout pas, fallback = IP de l'hôte sur le réseau Docker, ou `--network host` (Linux).
- préfixe `openai/` obligatoire (routage litellm vers un endpoint OpenAI-compatible).

## 3. Lancer contre AdCraft (instance de test)

```powershell
# 1) démarre AdCraft en test (docker-compose du repo), note l'URL (ex http://localhost:8080)
# 2) Strix sur le code + l'instance qui tourne :
strix --target .                         # scan du repo (statique+dynamique)
#   ou cible l'app lancée :
strix --target http://localhost:8080
```

Garde-fous :
- budget modèle local = gratuit en €, mais surveille VRAM/RAM et les boucles.
- `-n` pour un run headless ; `strix view` pour le dashboard local des résultats.
- résultats dans `strix_runs/<run-name>`.
- **uniquement** sur ton instance de test. Pas la prod `ads.devwork.cloud` sans snapshot.

## 4. Si c'est trop lent / trop faible
- descends à `qwen3:8b` (VRAM libre, tu bosses à côté) pour dégrossir, remonte au 14B pour un run propre.
- réduis la portée (un module à la fois) plutôt qu'un scan total.
- le cloud API reste le plan B comparatif (~3-10 $/passe) si le local ne sort rien d'exploitable.
