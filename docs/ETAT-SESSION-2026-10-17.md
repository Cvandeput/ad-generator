# État session — 2026-10-17

3 chantiers : aléatoire pub AdCraft, Strix en local, tri mail local.

## P1 — Aléatoire des fonds AdCraft  ✅ codé & testé (pas commité)

**Diagnostic réel** : les prompts n'étaient pas figés. Le Directeur Artistique
(Gemini texte) avait déjà 3-8 décors candidats par thème mais **convergeait**
toujours sur le même (choix du décor laissé au modèle + few-shot ancrants + aucune
mémoire). D'où la redondance.

**Fix** : le choix du décor passe du modèle au code.
- `shared/prompt.mjs` + `tools/build-n8n.mjs` : tirage pondéré décor + caméra,
  anti-répétition persistante (`$getWorkflowStaticData`, option A), le DA reçoit
  **un seul décor imposé** à concrétiser.
- Pools élargis : classique 3→6, extravagant 5→7, luxe 5→7 ; +4 variantes caméra/thème.
- `n8n/generateur-publicite.json` régénéré. Champ `variant` (décor+caméra tirés)
  remonté dans la réponse webhook pour traçabilité.
- Vérifié : même décor jamais avant 5 générations, distribution uniforme,
  3 briefs « Été » consécutifs = rochers / terrasse / plage, angles différents.
  Syntaxe des 3 nodes OK.

**Reste côté Corentin** :
- relancer `node tools/build-n8n.mjs` si retouche de la source,
- importer le JSON dans n8n,
- lancer une vraie génération (VPS/Vertex) pour valider le rendu,
- commit (laissé non commité : `main` a du WIP non lié).

## P2 — Strix en local  ⏳ runbook prêt, exécution côté Corentin

Voie B assumée (100% local, VRAM sacrifiée pendant la passe).
Runbook complet : `docs/STRIX-LOCAL-SETUP.md`.
- Modèle : **Qwen3 14B Q4** (tool-calling natif), contexte 16K (`qwen3-14b-16k`).
- Ollama `OLLAMA_HOST=0.0.0.0`, Strix `LLM_API_BASE=http://host.docker.internal:11434/v1`.
- Attendu honnête : un 14B local reste faible pour du pentest agentique.
- Cible : instance de TEST AdCraft uniquement.

**Reste côté Corentin** :
- lancer `run_probe.cmd` (voir ci-dessous) pour pull les modèles,
- `pipx install strix-agent`, Docker Desktop lancé,
- fournir l'URL de l'instance de test AdCraft.

## P3 — Tri mail local  ⏳ outil prêt, attend credentials Gmail

Livré en chat : `triage.py` + `README.md` (dossier `triage_mail_local`).
100% local (Ollama `qwen3:8b`), dry-run par défaut.
Taxonomie : junk→corbeille, notif→archive, stage→label `Stage` + brouillon
(jamais envoyé), keep→rien.
**Exclusion dure Celine Lyson** : filtrée à la requête Gmail + re-vérifiée par
message, jamais lue au-delà du From. Aucun mail touché pour l'instant.

**Reste côté Corentin** :
- créer `credentials.json` OAuth (Cloud Console → API Gmail → client Desktop),
  le poser à côté de `triage.py`,
- `ollama pull qwen3:8b` (fait par run_probe.cmd),
- lancer `python triage.py` (dry-run) puis `--apply`.

## Blocage plateforme (pourquoi Corentin doit lancer lui-même)

Le contrôle du PC interdit de taper dans un terminal Windows / d'exécuter des
commandes shell sur le host, et la VM Linux ne voit ni Ollama ni le GPU.
→ Les `ollama pull` et tests host se lancent côté Corentin.

**Script prêt** : `test-adcraft\run_probe.cmd` (double-clic). Pull qwen3:8b +
qwen3:14b, crée qwen3-14b-16k, smoke-test classif. Log → `test-adcraft\_probe.log`
(que Claude relit ensuite depuis la VM).

## Ce que Claude attend pour reprendre
1. `_probe.log` rempli → vérif env + modèles.
2. `credentials.json` déposé → branchement tri mail (dry-run).
3. URL instance test AdCraft → prépa run Strix.
4. Feu vert import n8n / commit P1.
