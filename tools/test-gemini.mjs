// Test rapide du prompt/génération SANS n8n ni backend.
// Deux modes d'auth (auto-détectés) :
//   - VERTEX AI  : si GOOGLE_APPLICATION_CREDENTIALS (chemin d'une clé JSON de
//                  service account) est défini. Utilise ton crédit Google Cloud 300€.
//   - AI STUDIO  : sinon, via GEMINI_API_KEY (clés AIza ; les AQ. sont bloquées).
//
// Lance depuis la racine du repo (clé/chemin dans .env) :
//   node tools/test-gemini.mjs --brand "Red Bull" --category "boisson énergisante" \
//        --theme classique --size 512 --ratio 4:5 --img test\redbull_classique.png
//
// Options : --theme classique|ete|extravagant|sport|fete|luxe|noel
//           --size 512|1K|2K|4K   --ratio 1:1|4:5|9:16|16:9
//           --img <path> (répétable)   --model <id>

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildGeminiBody, buildPrompt } from '../shared/prompt.mjs';

// Charge un fichier .env à la racine si présent (parser minimal, sans dépendance).
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const COST = { '512': 0.045, '1K': 0.134, '2K': 0.134, '4K': 0.24 }; // Nano Banana Pro, $/image

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const next = argv[i + 1];
    const v = next && !next.startsWith('--') ? argv[++i] : true;
    if (k === 'img') (args.img = args.img || []).push(v);
    else args[k] = v;
  }
  return args;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Mint un access token OAuth2 depuis une clé de service account (JWT RS256).
async function getVertexToken(saPath) {
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  const jwt = `${signingInput}.${b64url(signature)}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Échec du token OAuth : ${JSON.stringify(j)}`);
  return { token: j.access_token, projectId: sa.project_id };
}

async function main() {
  const a = parseArgs();
  const MODEL = a.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
  const brand = a.brand || 'Red Bull';
  const category = a.category || 'boisson énergisante';
  const flavor = a.flavor || '';
  const theme = a.theme || 'classique';
  const aspectRatio = a.ratio || '1:1';
  // Gemini 2.5 image ne gère pas les paliers imageSize → on l'omet.
  const supportsImageSize = !MODEL.includes('2.5');
  const imageSize = supportsImageSize ? (a.size || '1K') : null;
  const imgPaths = a.img || ['docs/images/input-redbull.jpg'];

  const images = [];
  for (const p of imgPaths) {
    if (!fs.existsSync(p)) {
      console.error(`❌ Image introuvable : ${p}`);
      return 1;
    }
    images.push({ mimeType: MIME[path.extname(p).toLowerCase()] || 'image/jpeg', data: fs.readFileSync(p).toString('base64') });
  }

  // --- Choix du mode d'auth ---
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const apiKey = process.env.GEMINI_API_KEY;
  let url;
  let authHeader;
  let mode;

  if (saPath && fs.existsSync(saPath)) {
    mode = 'VERTEX';
    const location = process.env.GEMINI_LOCATION || 'global';
    const { token, projectId } = await getVertexToken(saPath);
    const project = process.env.GOOGLE_CLOUD_PROJECT || projectId;
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${MODEL}:generateContent`;
    authHeader = { Authorization: `Bearer ${token}` };
    console.log(`🔐 Mode VERTEX — projet ${project}, location ${location}`);
  } else if (apiKey) {
    mode = 'AISTUDIO';
    const isAQ = apiKey.startsWith('AQ.');
    authHeader = isAQ ? { Authorization: `Bearer ${apiKey}` } : { 'x-goog-api-key': apiKey };
    url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    console.log(`🔐 Mode AI STUDIO${isAQ ? ' (clé AQ. en Bearer)' : ''}`);
  } else {
    console.error('❌ Aucune auth. Définis GOOGLE_APPLICATION_CREDENTIALS (Vertex) ou GEMINI_API_KEY (AI Studio) dans .env.');
    return 1;
  }

  console.log('=== Config ===');
  console.log({ mode, MODEL, brand, category, flavor, theme, imageSize, aspectRatio, images: imgPaths });
  console.log(`\n=== Prompt envoyé ===\n${buildPrompt({ brand, category, flavor, theme })}\n`);
  const estCost = imageSize ? (COST[imageSize] ?? 0.134) : 0.039; // 2.5 flash image ≈ $0.039
  console.log(`≈ coût : $${estCost.toFixed(3)} / image\n`);

  const body = buildGeminiBody({ brand, category, flavor, theme, images, imageSize, aspectRatio });
  const opts = { method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };

  // Retry sur 429 (quota Vertex par minute souvent bas) : 8s, 16s, 24s, 32s.
  const t0 = Date.now();
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url, opts);
    if (res.status !== 429 || attempt > 4) break;
    const wait = attempt * 8;
    console.log(`⏳ 429 quota atteint — attente ${wait}s puis retry (${attempt}/4)…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }

  if (!res.ok) {
    console.error(`❌ HTTP ${res.status}\n${await res.text()}`);
    return 1;
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let saved = false;
  for (const p of parts) {
    if (p.text) console.log('[texte modèle]', p.text);
    const inl = p.inlineData || p.inline_data;
    if (inl?.data) {
      const ext = (inl.mimeType || 'image/png').includes('jpeg') ? 'jpg' : 'png';
      const outDir = path.join('tools', 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const out = path.join(outDir, `${Date.now()}-${theme}-${imageSize}.${ext}`);
      fs.writeFileSync(out, Buffer.from(inl.data, 'base64'));
      console.log(`✅ Image sauvegardée : ${out}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      saved = true;
    }
  }
  if (!saved) {
    console.error('❌ Aucune image renvoyée. Réponse brute :\n', JSON.stringify(data).slice(0, 1200));
    return 1;
  }
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((err) => {
  console.error('❌', err.message);
  process.exitCode = 1;
});
