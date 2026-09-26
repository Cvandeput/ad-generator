// Coût interne : jamais montré à un client.
//
//   node --test tests/usage-visibility.test.js
//
// Le client paie une formule (0,20 à 0,33 € par visuel) ; le prix de revient
// (montant, modèle, fournisseur) ne doit sortir que vers un admin. Ce fichier
// verrouille /api/usage, la réponse de /api/generate et /api/history, avec et
// sans facturation, contre deux vrais serveurs et une doublure de n8n.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N8N_PORT = 3533;

const CLIENT = 'lea.martin@fromagerie-du-plateau.be';
const ADMIN = 'exploitant@adcraft.test';
const MDP = 'Tomme-Affinee-2026!';

// PNG 1×1 valide : generate.js vérifie la signature, pas le Content-Type.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Clés qui trahissent le prix de revient, cherchées à toute profondeur.
const COST_KEYS = ['eur', 'usd', 'unit', 'rate', 'costEur', 'costUsd', 'model'];
function costKeysIn(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(COST_KEYS.includes(k) ? [`${prefix}${k}`] : []),
    ...costKeysIn(v, `${prefix}${k}.`),
  ]);
}

// Doublure n8n : répond tout de suite avec une image valide.
const n8n = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ image: PNG.toString('base64'), prompt: 'prompt de test' }));
  });
});

// Un serveur de test = un processus, une base, un pot à cookies par compte.
function makeServer(port, billing) {
  const base = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `adcraft-usage-${billing ? 'billing' : 'nobilling'}-`));
  const cookies = {};
  let proc;

  async function call(who, pathname, { method = 'GET', body, form } = {}) {
    const res = await fetch(base + pathname, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookies[who] ? { Cookie: cookies[who] } : {}),
        Origin: base,
      },
      body: form || (body ? JSON.stringify(body) : undefined),
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const v = c.split(';')[0];
      if (v.split('=')[1]) cookies[who] = v;
    }
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  async function start() {
    proc = spawn(process.execPath, ['--import', './tests/helpers/register.mjs', 'src/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env, NODE_ENV: 'development', DATA_DIR: dataDir, PORT: String(port),
        SESSION_SECRET: 'a'.repeat(48), N8N_TOKEN: 'b'.repeat(32),
        N8N_WEBHOOK_URL: `http://127.0.0.1:${N8N_PORT}/webhook`,
        BILLING_ENABLED: billing ? 'true' : 'false', STRIPE_SECRET_KEY: '',
        REGISTER_MODE: 'open', EMAIL_VERIFICATION: 'false', SMTP_HOST: '',
        ADMIN_EMAILS: ADMIN, SEED_USERS: '', FREE_PLAN_QUOTA: '5',
        COST_PER_IMAGE_USD: '0.067', EMAIL_HASH_PEPPER: 'c'.repeat(48),
        APP_ORIGINS: base,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => process.stderr.write(`[serveur ${port}] ${d}`));
    for (let i = 0; i < 100; i += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* pas prêt */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`le serveur de test ${port} ne démarre pas`);
  }

  async function stop() {
    // Attendre la MORT du serveur avant d'effacer : sous Windows, la base encore
    // ouverte par le processus enfant fait échouer rmSync en EPERM.
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      await new Promise((r) => { proc.once('exit', r); proc.kill('SIGKILL'); });
    }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  async function register(who, email) {
    const r = await call(who, '/api/auth/register', { method: 'POST', body: { email, password: MDP, acceptTerms: true } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }

  function generate(who) {
    const fd = new FormData();
    fd.append('brand', 'Fromagerie du Plateau');
    fd.append('category', 'épicerie');
    fd.append('theme', 'classique');
    fd.append('images', new Blob([PNG], { type: 'image/png' }), 'tomme.png');
    return call(who, '/api/generate', { method: 'POST', form: fd });
  }

  return { start, stop, call, register, generate };
}

const withBilling = makeServer(3531, true);
const withoutBilling = makeServer(3532, false);

before(async () => {
  await new Promise((r) => n8n.listen(N8N_PORT, '127.0.0.1', r));
  await Promise.all([withBilling.start(), withoutBilling.start()]);
});

after(async () => {
  await Promise.all([withBilling.stop(), withoutBilling.stop()]);
  await new Promise((r) => n8n.close(r));
});

test('facturation active : un client ne reçoit aucun montant sur /api/usage, mais son quota', async () => {
  const s = withBilling;
  await s.register('client', CLIENT);

  const u = await s.call('client', '/api/usage');
  assert.equal(u.status, 200);
  assert.deepEqual(costKeysIn(u.json), [], `champs de coût exposés : ${JSON.stringify(u.json)}`);
  assert.equal(u.json.isAdmin, false);
  assert.equal(u.json.currentMonth.count, 0);
  assert.deepEqual(
    { quota: u.json.billing.quota, used: u.json.billing.used, remaining: u.json.billing.remaining, credits: u.json.billing.credits, lifetime: u.json.billing.lifetime },
    { quota: 5, used: 0, remaining: 5, credits: 0, lifetime: true },
    'formule gratuite : 5 générations offertes, à vie'
  );
});

test('facturation active : la génération et l’historique d’un client ne portent pas le coût', async () => {
  const s = withBilling;
  const g = await s.generate('client');
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(g.json.status, 'done');
  assert.deepEqual(costKeysIn(g.json), [], `réponse de génération : ${JSON.stringify(g.json)}`);

  const h = await s.call('client', '/api/history?status=done');
  assert.equal(h.json.items.length, 1);
  assert.deepEqual(costKeysIn(h.json), [], `historique : ${JSON.stringify(h.json)}`);

  const u = await s.call('client', '/api/usage');
  assert.deepEqual(costKeysIn(u.json), []);
  assert.equal(u.json.currentMonth.count, 1);
  assert.equal(u.json.billing.used, 1);
  assert.equal(u.json.billing.remaining, 4, 'le solde suit la consommation');
});

test('un admin garde le coût unitaire, les montants et un quota illimité', async () => {
  const s = withBilling;
  await s.register('admin', ADMIN);
  const me = await s.call('admin', '/api/auth/me');
  assert.equal(me.json.user.isAdmin, true, 'ADMIN_EMAILS donne le rôle admin à la création');

  const g = await s.generate('admin');
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(typeof g.json.costEur, 'number');

  const u = await s.call('admin', '/api/usage');
  assert.equal(u.json.isAdmin, true);
  assert.equal(typeof u.json.unit.eur, 'number');
  assert.equal(typeof u.json.unit.model, 'string');
  assert.equal(typeof u.json.currentMonth.eur, 'number');
  assert.equal(u.json.billing.unlimited, true);
  assert.equal(u.json.billing.remaining, undefined, 'pas d’Infinity sérialisé en null');

  const h = await s.call('admin', '/api/history?status=done');
  assert.equal(typeof h.json.items[0].costEur, 'number');
});

test('sans facturation : /api/usage répond, sans montant ni état de quota pour un client', async () => {
  const s = withoutBilling;
  await s.register('client', CLIENT);
  const g = await s.generate('client');
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.deepEqual(costKeysIn(g.json), []);

  const u = await s.call('client', '/api/usage');
  assert.equal(u.status, 200);
  assert.deepEqual(costKeysIn(u.json), [], JSON.stringify(u.json));
  assert.equal(u.json.billing, undefined, 'aucun module de facturation chargé');
  assert.equal(u.json.currentMonth.count, 1);

  await s.register('admin', ADMIN);
  const a = await s.call('admin', '/api/usage');
  assert.equal(typeof a.json.unit.eur, 'number', 'le coût reste visible pour l’admin sans facturation');
});
