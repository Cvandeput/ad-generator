// Génère n8n/generateur-publicite.json à partir de shared/prompt.mjs.
// Garantit que briefs/presets/prompt du workflow n8n = ceux du harnais (zéro drift).
// Lancer après toute modif de shared/prompt.mjs :  node tools/build-n8n.mjs
//
// Pipeline : Webhook → Build DA Request → Directeur Artistique (Gemini texte, VOIT les photos)
//            → Build Prompt → Nano Banana (image) → Extract Image → Respond
// Le Directeur Artistique fait l'inventaire des produits (toutes les photos) et
// invente UNE scène dans le monde du thème. Build Prompt applique la priorité :
// décor manuel > scène IA (JSON valide) > repli preset statique.

import fs from 'node:fs';
import path from 'node:path';
import {
  PRESETS,
  FIDELITY,
  AVOID,
  DA_SYSTEM,
  DA_SCHEMA,
  DA_FEWSHOT,
  THEME_BRIEFS,
  MAX_PRODUCTS,
} from '../shared/prompt.mjs';

// --- Node « Build DA Request » : valide le token, nettoie les entrées, assemble
// le corps de requête du Directeur Artistique (brief + PHOTOS), fait suivre le body. ---
const buildDaRequestCode = `
const payload = $input.first().json;
const body = payload.body || payload;
const headers = payload.headers || {};
const expected = $env.WEBHOOK_TOKEN;
if (!expected) { throw new Error('WEBHOOK_TOKEN non configure cote n8n'); }
if (headers['x-webhook-token'] !== expected) { throw new Error('Token webhook invalide'); }

const { brand, category, flavor, theme, description, artDirection, images } = body;
if (!brand || !category || !theme) { throw new Error('Champs requis manquants (brand, category, theme)'); }
if (!images || !images.length) { throw new Error('Aucune image fournie'); }

// Defense en profondeur : le backend nettoie deja, mais le node peut etre appele
// directement. Retire caracteres de controle, collapse les espaces, tronque.
const clean = (s, max) => String(s || '').replace(/\\p{Cc}/gu, ' ').replace(/\\s+/g, ' ').trim().slice(0, max);
const desc = clean(description, 120);
const art = clean(artDirection, 200);
const cleanBrand = clean(brand, 60);
const cleanFlavor = clean(flavor, 60);
let productCount = Number(body.productCount) || null;
if (productCount && (productCount < 1 || productCount > ${MAX_PRODUCTS})) { productCount = null; }

const NL = String.fromCharCode(10);
const DA_SYSTEM = ${JSON.stringify(DA_SYSTEM)};
const DA_SCHEMA = ${JSON.stringify(DA_SCHEMA)};
const DA_FEWSHOT = ${JSON.stringify(DA_FEWSHOT)};
const THEME_BRIEFS = ${JSON.stringify(THEME_BRIEFS)};

function themeBriefText(t) {
  const b = THEME_BRIEFS[t] || THEME_BRIEFS.classique;
  return [
    'THEME: ' + b.label,
    'INTENT: ' + b.intent,
    'CANDIDATE SETTINGS (choose one): ' + b.settings.map((s, i) => '(' + (i + 1) + ') ' + s).join(' '),
    'LIGHT: ' + b.light,
    'PALETTE: ' + b.palette,
    'ENERGY: ' + b.energy,
    'CAMERA: ' + b.camera,
    'PROPS: ' + b.props,
    'FORBID: ' + b.forbid,
  ].join(NL);
}

const daContents = DA_FEWSHOT.map((ex) => ({ role: ex.role, parts: [{ text: ex.text }] }));
const userText = [
  'brand: ' + cleanBrand,
  'category: ' + category,
  'description: ' + (desc || '(none)'),
  'flavour: ' + (cleanFlavor || '(none)'),
  'expected product count: ' + (productCount ? productCount : '(not specified — count from the photos)'),
  '',
  themeBriefText(theme),
  '',
  'Reference photos follow (' + images.length + ').',
].join(NL);
// Le DA VOIT les photos : indispensable pour l'inventaire des produits.
const userParts = [{ text: userText }];
for (const img of images) { userParts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } }); }
daContents.push({ role: 'user', parts: userParts });

const daBody = {
  systemInstruction: { parts: [{ text: DA_SYSTEM }] },
  contents: daContents,
  generationConfig: { responseMimeType: 'application/json', responseSchema: DA_SCHEMA, temperature: 0.7 }
};

return [{ json: { daBody, body: { ...body, brand: cleanBrand, flavor: cleanFlavor }, desc, art, productCount } }];
`.trim();

// --- Node « Build Prompt » : fusionne la réponse du Directeur Artistique avec le
// body original, applique la priorité (manuel > IA > repli), assemble le prompt
// image final (énumération explicite des produits) et journalise la source. ---
const buildPromptCode = `
const da = $input.first().json;                       // reponse Directeur Artistique (ou erreur si continueOnFail)
const ctx = $('Build DA Request').first().json;       // body original + champs nettoyes
const { body, desc, art, productCount } = ctx;
const { brand, category, flavor, theme, images } = body;
const NL = String.fromCharCode(10);

const FIDELITY = ${JSON.stringify(FIDELITY)};
const AVOID = ${JSON.stringify(AVOID)};
const PRESETS = ${JSON.stringify(PRESETS, null, 2)};
const MAX_PRODUCTS = ${MAX_PRODUCTS};

// Extrait et valide le JSON du Directeur Artistique. Un JSON syntaxiquement
// valide mais ampute d'un champ declenche le repli.
function parseDA(resp) {
  try {
    const cands = (resp && resp.candidates) || (resp && resp.body && resp.body.candidates) || [];
    const parts = cands[0] && cands[0].content && cands[0].content.parts;
    const text = parts && parts[0] && parts[0].text;
    if (!text) return null;
    const o = JSON.parse(text);
    for (const k of ['setting', 'surface', 'props', 'framing', 'light', 'palette', 'mood']) { if (o[k] == null || o[k] === '') return null; }
    if (!Array.isArray(o.props)) return null;
    if (!Array.isArray(o.products)) o.products = [];
    o.products = o.products.filter((p) => p && p.name).slice(0, MAX_PRODUCTS);
    return o;
  } catch (e) { return null; }
}

function lead(n) {
  const subject = n > 1 ? n + ' ' + brand + ' products (' + category + ')' : brand + ' ' + category;
  return 'Professional advertising photograph of ' + subject + (desc ? ' \\u2014 ' + desc : '') + (flavor ? ', ' + flavor + ' flavor' : '') + '.';
}

function productsBlock(products, n) {
  if (n <= 1) {
    return 'PRODUCTS: exactly one product, the one shown in the reference images. It is the single hero of the image, fully visible and unobstructed.';
  }
  const list = products.length
    ? products.map((p, i) => (i + 1) + '. ' + [p.name, p.form].filter(Boolean).join(' \\u2014 ')).join('; ')
    : n + ' distinct products shown across the reference images';
  return 'PRODUCTS: exactly ' + n + ' distinct products, all in the same frame, none missing, none duplicated, none invented: ' + list + '. '
    + 'Each reference image may show one or several of them; if several photos show the same product from different angles, it is still ONE product. '
    + 'Arrange them as one group in the same scene, staggered in depth (hero slightly in front), every label facing the camera, each product fully visible and unobstructed.';
}

function renderScene(o, n) {
  const props = (o.props || []).slice(0, 3).join(', ');
  return [
    'SCENE: ' + o.setting + '. The product' + (n > 1 ? 's rest' : ' rests') + ' on ' + o.surface + '.' + (props ? ' Nearby: ' + props + '.' : ''),
    o.arrangement ? 'ARRANGEMENT: ' + o.arrangement : null,
    'FRAMING: ' + o.framing,
    'LIGHT: ' + o.light,
    'PALETTE: ' + o.palette,
    'MOOD: ' + o.mood,
  ].filter(Boolean).join(NL);
}

// Inventaire : le nombre saisi par l'utilisateur prime ; sinon celui du DA ; sinon 1.
const parsed = parseDA(da);
let products = parsed ? parsed.products : [];
let n = productCount || (products.length || 1);
if (productCount && products.length > productCount) products = products.slice(0, productCount);

// Priorite : decor manuel > scene IA valide > repli preset statique.
let scene, source;
if (art) { scene = 'SCENE: ' + art; source = 'manual'; }
else if (parsed) { scene = renderScene(parsed, n); source = 'auto'; }
else { scene = PRESETS[theme] || PRESETS.classique; source = 'fallback'; }

const prompt = [lead(n), productsBlock(products, n), scene, FIDELITY, AVOID].join(NL);

const parts = [{ text: prompt }];
for (const img of images) { parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } }); }

// imageSize (0.5K/1K/2K/4K) : gemini-3.1-flash-image et gemini-3-pro-image.
// Absent => omis (compat gemini-2.5-flash-image, retire le 2 oct. 2026).
const imageSize = $env.GEMINI_IMAGE_SIZE || '';
const model = $env.GEMINI_MODEL || 'gemini-3.1-flash-image';
const imageConfig = { aspectRatio: '4:5' };
if (imageSize) { imageConfig.imageSize = imageSize; }

const geminiBody = {
  contents: [{ role: 'user', parts }],
  generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig }
};
return [{ json: { geminiBody, prompt, artDirectionSource: source, productCount: n, products, model, imageSize } }];
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
return [{ json: { image, mimeType, prompt: bp.prompt, artDirectionSource: bp.artDirectionSource, productCount: bp.productCount, products: bp.products, model: bp.model, imageSize: bp.imageSize } }];
`.trim();

const VERTEX = (modelExpr) =>
  `=https://aiplatform.googleapis.com/v1/projects/{{ $env.GCP_PROJECT }}/locations/global/publishers/google/models/${modelExpr}:generateContent`;

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
        // Modèle TEXTE multimodal (voit les photos). Projet + modèle via variables d'env n8n.
        url: VERTEX("{{ $env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash' }}"),
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleApi',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.daBody) }}',
        options: { timeout: 45000 },
      },
      name: 'Directeur Artistique',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [640, 300],
      credentials: { googleApi: { id: 'REMPLACER', name: 'Google Service Account' } },
      // Repli obligatoire : une erreur du modèle texte ne doit pas faire échouer
      // la génération. Build Prompt bascule alors sur le preset statique.
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
        // Endpoint Vertex AI (global). GEMINI_MODEL : gemini-3.1-flash-image (défaut),
        // gemini-3-pro-image (qualité max), gemini-2.5-flash-image (retiré le 2 oct. 2026).
        url: VERTEX("{{ $env.GEMINI_MODEL || 'gemini-3.1-flash-image' }}"),
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
          '={{ { "image": $json.image, "mimeType": $json.mimeType, "prompt": $json.prompt, "artDirectionSource": $json.artDirectionSource, "productCount": $json.productCount, "products": $json.products, "model": $json.model, "imageSize": $json.imageSize } }}',
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
console.log(`✅ ${out} régénéré (${Object.keys(PRESETS).length} thèmes, DA multimodal + inventaire produits).`);
