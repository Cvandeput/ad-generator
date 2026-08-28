// Génère n8n/generateur-publicite.json à partir de shared/prompt.mjs.
// Garantit que les presets/prompt du workflow n8n = ceux du harnais (zéro drift).
// Lancer après toute modif de shared/prompt.mjs :  node tools/build-n8n.mjs
//
// Pipeline : Webhook → Build DA Request → Directeur Artistique (Gemini texte)
//            → Build Prompt → Nano Banana (image) → Extract Image → Respond
// Le Directeur Artistique invente une scène spécifique au produit. Build Prompt
// applique la priorité : décor manuel > scène IA (JSON valide) > repli thème.
// FIDELITY / AVOID / PRESETS viennent de shared/prompt.mjs ; la logique DA est
// propre à n8n (le harnais Node ne peut pas appeler le modèle texte).

import fs from 'node:fs';
import path from 'node:path';
import { PRESETS, FIDELITY, AVOID, PRODUCTS } from '../shared/prompt.mjs';

// --- Directeur Artistique : système, schéma de sortie, exemples few-shot ---

const DA_SYSTEM = `You are an art director for commercial product photography. Given a product, you design ONE specific scene that makes the product's identity legible at a glance.

Method:
1. Identify what the product is literally made of, where it comes from, and when it is consumed.
2. Derive an environment from that identity - not a generic studio, not a stock background. Crisps come from potatoes and farms. San Pellegrino comes from an Italian table. Energy drinks belong where energy is spent. A frozen croissant belongs in a morning kitchen.
3. Choose a surface the product physically rests on, and at most four props that belong in that world. Every prop must have a reason to be there.
4. Respect the requested theme as a STYLE constraint applied to that environment, not as a replacement for it. "Luxe" on crisps is a refined farmhouse, not a marble podium.

Rules:
- Be concrete. "Rustic wooden crate on straw, raw potatoes with soil still on them" beats "farm setting".
- Never describe the product's own packaging, label, logo or text. Another system handles that.
- Never include people, hands, faces, other brands, or any text, sign or signage in the scene.
- Keep each field under 25 words.

Input: brand, category, description, flavour, theme.
Output: the JSON object only.`;

const DA_SCHEMA = {
  type: 'object',
  required: ['setting', 'surface', 'props', 'framing', 'light', 'palette', 'mood'],
  properties: {
    setting: { type: 'string' },
    surface: { type: 'string' },
    props: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    framing: { type: 'string' },
    light: { type: 'string' },
    palette: { type: 'string' },
    mood: { type: 'string' },
  },
};

// Exemples : ils portent l'essentiel de la qualité (niveau de spécificité attendu).
// Morphologies différentes : sachet, bouteille, pâtisserie.
const NL = '\n';
const daUser = (brand, category, description, flavour, theme) =>
  [`brand: ${brand}`, `category: ${category}`, `description: ${description}`, `flavour: ${flavour}`, `theme: ${theme}`].join(NL);

const DA_FEWSHOT = [
  {
    role: 'user',
    text: daUser("Lay's", 'crisps', '(none)', '(none)', 'classique'),
  },
  {
    role: 'model',
    text: JSON.stringify({
      setting: 'old stone barn interior, afternoon light through an open door',
      surface: 'rough wooden crate lined with burlap',
      props: ['raw potatoes with soil', 'scattered straw', 'vintage metal scale'],
      framing: 'eye-level, product centred on the crate',
      light: 'warm directional daylight from the left, dust in the air',
      palette: 'earthy browns, straw gold, muted green',
      mood: 'rustic, authentic, artisanal',
    }),
  },
  {
    role: 'user',
    text: daUser('San Pellegrino', 'sparkling water', '(none)', 'lemon', 'ete'),
  },
  {
    role: 'model',
    text: JSON.stringify({
      setting: 'sunlit terrace overlooking an Italian coastal village',
      surface: 'marble bistro table',
      props: ['fresh lemons with leaves', 'linen napkin', 'small espresso cup'],
      framing: 'slightly low angle, bottle standing',
      light: 'midday Mediterranean sun, hard shadows, bright bounce',
      palette: 'azure blue, lemon yellow, warm white',
      mood: 'bright, leisurely, Mediterranean',
    }),
  },
  {
    role: 'user',
    text: daUser('Nutella', 'frozen pastry', 'croissant filled with Nutella', '(none)', 'classique'),
  },
  {
    role: 'model',
    text: JSON.stringify({
      setting: 'morning kitchen counter, soft window light',
      surface: 'white ceramic plate on light oak',
      props: ['open Nutella jar', 'hazelnuts', 'coffee cup', 'linen cloth'],
      framing: 'eye-level, three-quarter view',
      light: 'soft diffused morning light from the right',
      palette: 'warm cream, hazelnut brown, soft white',
      mood: 'cosy, homely, inviting',
    }),
  },
];

// --- Node « Build DA Request » : valide le token, nettoie les entrées, assemble
// le corps de requête du Directeur Artistique, et fait suivre le body original. ---
const buildDaRequestCode = `
const payload = $input.first().json;
const body = payload.body || payload;
const headers = payload.headers || {};
const expected = $env.WEBHOOK_TOKEN;
if (expected && headers['x-webhook-token'] !== expected) { throw new Error('Token webhook invalide'); }

const { brand, category, flavor, theme, description, artDirection, images } = body;
if (!brand || !category || !theme) { throw new Error('Champs requis manquants (brand, category, theme)'); }
if (!images || !images.length) { throw new Error('Aucune image fournie'); }

// Defense en profondeur : le backend nettoie deja, mais le node peut etre appele
// directement. Retire caracteres de controle, collapse les espaces, tronque.
// (commentaires sans accents : evite tout probleme d'encodage dans l'editeur n8n)
const clean = (s, max) => String(s || '').replace(/\\p{Cc}/gu, ' ').replace(/\\s+/g, ' ').trim().slice(0, max);
const desc = clean(description, 120);
const art = clean(artDirection, 200);

const NL = String.fromCharCode(10);
const DA_SYSTEM = ${JSON.stringify(DA_SYSTEM)};
const DA_SCHEMA = ${JSON.stringify(DA_SCHEMA)};
const DA_FEWSHOT = ${JSON.stringify(DA_FEWSHOT)};

const daContents = DA_FEWSHOT.map((ex) => ({ role: ex.role, parts: [{ text: ex.text }] }));
const userLine = ['brand: ' + brand, 'category: ' + category, 'description: ' + (desc || '(none)'), 'flavour: ' + (flavor || '(none)'), 'theme: ' + theme].join(NL);
daContents.push({ role: 'user', parts: [{ text: userLine }] });

const daBody = {
  systemInstruction: { parts: [{ text: DA_SYSTEM }] },
  contents: daContents,
  generationConfig: { responseMimeType: 'application/json', responseSchema: DA_SCHEMA, temperature: 0.9 }
};

return [{ json: { daBody, body, desc, art } }];
`.trim();

// --- Node « Build Prompt » : fusionne la réponse du Directeur Artistique avec le
// body original, applique la priorité (manuel > IA > repli), assemble le prompt
// image final et journalise la source de la direction artistique. ---
const buildPromptCode = `
const da = $input.first().json;                       // reponse Directeur Artistique (ou erreur si continueOnFail)
const ctx = $('Build DA Request').first().json;       // body original + champs nettoyes
const { body, desc, art } = ctx;
const { brand, category, flavor, theme, images } = body;
const NL = String.fromCharCode(10);

const lead = 'Professional advertising photograph of ' + brand + ' ' + category + (desc ? ' \\u2014 ' + desc : '') + (flavor ? ', ' + flavor + ' flavor' : '') + '.';
const PRODUCTS = ${JSON.stringify(PRODUCTS)};
const FIDELITY = ${JSON.stringify(FIDELITY)};
const AVOID = ${JSON.stringify(AVOID)};
const PRESETS = ${JSON.stringify(PRESETS, null, 2)};

// Extrait et valide le JSON du Directeur Artistique. Un JSON syntaxiquement
// valide mais ampute d'un champ declenche aussi le repli.
function parseDA(resp) {
  try {
    const cands = (resp && resp.candidates) || (resp && resp.body && resp.body.candidates) || [];
    const parts = cands[0] && cands[0].content && cands[0].content.parts;
    const text = parts && parts[0] && parts[0].text;
    if (!text) return null;
    const o = JSON.parse(text);
    const req = ['setting', 'surface', 'props', 'framing', 'light', 'palette', 'mood'];
    for (const k of req) { if (o[k] == null || o[k] === '') return null; }
    if (!Array.isArray(o.props)) return null;
    return o;
  } catch (e) { return null; }
}

// Transforme les 7 champs en bloc SCENE (jamais le packaging).
function renderScene(o) {
  const props = o.props.slice(0, 4).join(', ');
  return [
    'SCENE: ' + o.setting + '. The product rests on ' + o.surface + '.' + (props ? ' Nearby: ' + props + '.' : ''),
    'FRAMING: ' + o.framing,
    'LIGHT: ' + o.light,
    'PALETTE: ' + o.palette,
    'MOOD: ' + o.mood
  ].join(NL);
}

// Priorite : decor manuel > scene IA valide > repli theme statique.
let scene, source;
if (art) {
  scene = art; source = 'manual';
} else {
  const parsed = parseDA(da);
  if (parsed) { scene = renderScene(parsed); source = 'auto'; }
  else { scene = PRESETS[theme] || PRESETS.classique; source = 'fallback'; }
}

// PRODUCTS juste apres le lead : impose TOUS les produits de reference avant que
// la scene ou les interdits ne s'appliquent. FIDELITY ancre a la photo (texte des
// emballages net + image prioritaire sur le mot-cle marque).
const prompt = lead + ' ' + PRODUCTS + ' ' + scene + ' ' + FIDELITY + ' ' + AVOID;

const parts = [{ text: prompt }];
for (const img of images) { parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } }); }

// imageSize (paliers 1K/2K/4K) : uniquement gemini-3-pro-image, ameliore la
// nettete du texte d'emballage. Gate par env : absent => omis (compat 2.5-flash).
const imageSize = $env.GEMINI_IMAGE_SIZE;
const imageConfig = { aspectRatio: '4:5' };
if (imageSize) { imageConfig.imageSize = imageSize; }

const geminiBody = {
  contents: [{ role: 'user', parts }],
  generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig }
};
return [{ json: { geminiBody, prompt, artDirectionSource: source } }];
`.trim();

const extractCode = `
const resp = $input.first().json;
const candidates = resp.candidates || (resp.body && resp.body.candidates) || [];
let image = null;
let mimeType = 'image/png';
for (const c of candidates) {
  const parts = (c.content && c.content.parts) || [];
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline && inline.data) { image = inline.data; mimeType = inline.mimeType || inline.mime_type || mimeType; break; }
  }
  if (image) break;
}
if (!image) { throw new Error('Vertex/Gemini: aucune image renvoyee. ' + JSON.stringify(resp).slice(0, 800)); }
const bp = $('Build Prompt').first().json;
return [{ json: { image, mimeType, prompt: bp.prompt, artDirectionSource: bp.artDirectionSource } }];
`.trim();

const workflow = {
  name: 'Generation Publicites IA - Nano Banana (Vertex AI)',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'generate-ads', responseMode: 'responseNode', options: {} },
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      webhookId: 'generate-ads',
    },
    {
      parameters: { jsCode: buildDaRequestCode },
      name: 'Build DA Request',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [440, 300],
    },
    {
      parameters: {
        method: 'POST',
        // Modèle TEXTE (pas image). Projet + modèle via variables d'env n8n.
        url: "=https://aiplatform.googleapis.com/v1/projects/{{ $env.GCP_PROJECT }}/locations/global/publishers/google/models/{{ $env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash' }}:generateContent",
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleApi',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.daBody) }}',
        options: { timeout: 30000 },
      },
      name: 'Directeur Artistique',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [640, 300],
      credentials: { googleApi: { id: 'REMPLACER', name: 'Google Service Account' } },
      // Repli obligatoire : une erreur du modèle texte ne doit pas faire échouer
      // la génération. Build Prompt bascule alors sur le thème statique.
      continueOnFail: true,
      onError: 'continueRegularOutput',
    },
    {
      parameters: { jsCode: buildPromptCode },
      name: 'Build Prompt',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [840, 300],
    },
    {
      parameters: {
        method: 'POST',
        // Endpoint Vertex AI (global). Projet + modèle via variables d'env n8n.
        // Changer de modèle = définir GEMINI_MODEL (ex: gemini-3-pro-image-preview) sans toucher au workflow.
        url: "=https://aiplatform.googleapis.com/v1/projects/{{ $env.GCP_PROJECT }}/locations/global/publishers/google/models/{{ $env.GEMINI_MODEL || 'gemini-2.5-flash-image' }}:generateContent",
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleApi',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.geminiBody) }}',
        options: { timeout: 120000 },
      },
      name: 'Nano Banana (Vertex)',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1040, 300],
      credentials: { googleApi: { id: 'REMPLACER', name: 'Google Service Account' } },
    },
    {
      parameters: { jsCode: extractCode },
      name: 'Extract Image',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1240, 300],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody:
          '={{ { "image": $json.image, "mimeType": $json.mimeType, "prompt": $json.prompt, "artDirectionSource": $json.artDirectionSource } }}',
        options: {},
      },
      name: 'Respond',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      position: [1440, 300],
    },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Build DA Request', type: 'main', index: 0 }]] },
    'Build DA Request': { main: [[{ node: 'Directeur Artistique', type: 'main', index: 0 }]] },
    'Directeur Artistique': { main: [[{ node: 'Build Prompt', type: 'main', index: 0 }]] },
    'Build Prompt': { main: [[{ node: 'Nano Banana (Vertex)', type: 'main', index: 0 }]] },
    'Nano Banana (Vertex)': { main: [[{ node: 'Extract Image', type: 'main', index: 0 }]] },
    'Extract Image': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
  },
  pinData: {},
  settings: { executionOrder: 'v1' },
};

const out = path.join('n8n', 'generateur-publicite.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`✅ ${out} régénéré (${Object.keys(PRESETS).length} thèmes, pipeline Directeur Artistique).`);
