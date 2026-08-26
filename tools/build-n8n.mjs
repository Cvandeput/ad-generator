// Génère n8n/generateur-publicite.json à partir de shared/prompt.mjs.
// Garantit que les presets/prompt du workflow n8n = ceux du harnais (zéro drift).
// Lancer après toute modif de shared/prompt.mjs :  node tools/build-n8n.mjs

import fs from 'node:fs';
import path from 'node:path';
import { PRESETS, FIDELITY } from '../shared/prompt.mjs';

const buildPromptCode = `
const payload = $input.first().json;
const body = payload.body || payload;
const headers = payload.headers || {};
const expected = $env.WEBHOOK_TOKEN;
if (expected && headers['x-webhook-token'] !== expected) { throw new Error('Token webhook invalide'); }

const { brand, category, flavor, theme, images } = body;
if (!brand || !category || !theme) { throw new Error('Champs requis manquants (brand, category, theme)'); }
if (!images || !images.length) { throw new Error('Aucune image fournie'); }

const lead = 'Professional advertising photograph of ' + brand + ' ' + category + (flavor ? ', ' + flavor + ' flavor' : '') + '.';
const FIDELITY = ${JSON.stringify(FIDELITY)};
const PRESETS = ${JSON.stringify(PRESETS, null, 2)};
const scene = PRESETS[theme] || PRESETS.classique;
const prompt = lead + ' ' + scene + ' ' + FIDELITY;

const parts = [{ text: prompt }];
for (const img of images) { parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } }); }

const geminiBody = {
  contents: [{ role: 'user', parts }],
  generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:5' } }
};
return [{ json: { geminiBody, prompt } }];
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
const prompt = $('Build Prompt').first().json.prompt;
return [{ json: { image, mimeType, prompt } }];
`.trim();

const workflow = {
  name: 'Génération Publicités IA — Nano Banana (Vertex AI)',
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
      parameters: { jsCode: buildPromptCode },
      name: 'Build Prompt',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
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
      position: [680, 300],
      credentials: { googleApi: { id: 'REMPLACER', name: 'Google Service Account' } },
    },
    {
      parameters: { jsCode: extractCode },
      name: 'Extract Image',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [900, 300],
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "image": $json.image, "mimeType": $json.mimeType, "prompt": $json.prompt } }}',
        options: {},
      },
      name: 'Respond',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      position: [1120, 300],
    },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Build Prompt', type: 'main', index: 0 }]] },
    'Build Prompt': { main: [[{ node: 'Nano Banana (Vertex)', type: 'main', index: 0 }]] },
    'Nano Banana (Vertex)': { main: [[{ node: 'Extract Image', type: 'main', index: 0 }]] },
    'Extract Image': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
  },
  pinData: {},
  settings: { executionOrder: 'v1' },
};

const out = path.join('n8n', 'generateur-publicite.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2) + '\n');
console.log(`✅ ${out} régénéré (${Object.keys(PRESETS).length} thèmes).`);
