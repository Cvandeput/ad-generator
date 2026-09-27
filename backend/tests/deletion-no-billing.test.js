// Suppression de compte SANS facturation (BILLING_ENABLED=false), et les
// portes latérales qui tournent autour.
//
//   node --test tests/deletion-no-billing.test.js
//
// Les deux autres fichiers de suppression tournent avec BILLING_ENABLED=true :
// c'est ce qui masquait le bug — `extra_credits` n'existait que si
// billing/store.js avait migré, et toute suppression échouait en 500 sur une
// base qui n'avait jamais eu la facturation. Ce fichier verrouille aussi :
//   - l'effacement RÉEL des fichiers (un vrai visuel et une vraie photo sur disque) ;
//   - le refus des adresses `.invalid`, domaine des adresses neutres ;
//   - la relance soumise à la vérification d'e-mail, comme /api/generate ;
//   - une génération qui se termine APRÈS la suppression du compte.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-nobilling-'));
const PORT = 3476;
const N8N_PORT = 3477; // doublure de n8n, servie par ce processus de test
const BASE = `http://127.0.0.1:${PORT}`;

const CLIENTE = 'margot@miellerie-des-fagnes.be';
const CLIENT = 'olivier@torrefaction-ourthe.be';
const MDP = 'Rayon-De-Miel-2026!';

// PNG 1×1 valide : generate.js vérifie la signature, pas le Content-Type.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

let server;
let cookie = '';

async function call(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: BASE },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const v = c.split(';')[0];
    if (v.split('=')[1]) cookie = v;
  }
  return { status: res.status, json: await res.json().catch(() => null) };
}
const openDb = async () => new (await import('better-sqlite3')).default(path.join(DATA_DIR, 'app.db'));

// Doublure n8n : retient sa réponse jusqu'à `release()`, pour que le test
// puisse supprimer le compte PENDANT la génération.
let reached;
const n8nReached = new Promise((r) => { reached = r; });
let release;
const n8nReleased = new Promise((r) => { release = r; });
const n8n = http.createServer((req, res) => {
  req.resume();
  req.on('end', async () => {
    reached();
    await n8nReleased;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ image: PNG.toString('base64'), prompt: 'prompt complet renvoyé par n8n' }));
  });
});

before(async () => {
  await new Promise((r) => n8n.listen(N8N_PORT, '127.0.0.1', r));
  server = spawn(process.execPath, ['--import', './tests/helpers/register.mjs', 'src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, NODE_ENV: 'development', DATA_DIR, PORT: String(PORT),
      SESSION_SECRET: 'a'.repeat(48), N8N_TOKEN: 'b'.repeat(32),
      N8N_WEBHOOK_URL: `http://127.0.0.1:${N8N_PORT}/webhook`,
      // LE point de ce fichier : la facturation n'a jamais été activée.
      BILLING_ENABLED: 'false', STRIPE_SECRET_KEY: '',
      REGISTER_MODE: 'open', EMAIL_VERIFICATION: 'true', SMTP_HOST: '',
      ADMIN_EMAILS: '', SEED_USERS: '', EMAIL_HASH_PEPPER: 'c'.repeat(48),
      APP_ORIGINS: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[serveur] ${d}`));
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('le serveur de test ne démarre pas');
});

after(async () => {
  release(); // ne jamais laisser une requête pendante bloquer la fermeture
  // Attendre la MORT du serveur avant d'effacer : sous Windows, la base encore
  // ouverte par le processus enfant fait échouer rmSync en EPERM.
  if (server && server.exitCode === null && server.signalCode === null) {
    await new Promise((r) => { server.once('exit', r); server.kill('SIGKILL'); });
  }
  await new Promise((r) => n8n.close(r));
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("l'inscription refuse les adresses du domaine .invalid (adresses neutres)", async () => {
  for (const email of ['deleted+1@account.invalid', 'Deleted+2@Account.INVALID']) {
    cookie = '';
    const r = await call('/api/auth/register', { method: 'POST', body: { email, password: MDP, acceptTerms: true } });
    assert.equal(r.status, 400, `${email} : ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error, 'Email invalide', 'même réponse qu’une adresse mal formée');
  }
  const db = await openDb();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE '%.invalid'").get().n, 0);
  db.close();
});

test("l'outillage du front (tools/) n'est pas servi", async () => {
  const r = await fetch(`${BASE}/tools/check-i18n.mjs`);
  assert.equal(r.status, 404);
});

let clienteId;
let genId;

test('la relance passe par la vérification d’e-mail, comme /api/generate', async () => {
  cookie = '';
  const r = await call('/api/auth/register', { method: 'POST', body: { email: CLIENTE, password: MDP, acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  clienteId = r.json.user.id;

  // Une génération réussie, avec ses fichiers RÉELS sur le disque.
  const db = await openDb();
  genId = db
    .prepare("INSERT INTO generations (user_id, brand, category, theme, status, cost_usd, prompt_used, description) VALUES (?, 'Miellerie des Fagnes', 'épicerie', 'classique', 'done', 0.101, 'un prompt complet', 'pot de miel de bruyère')")
    .run(clienteId).lastInsertRowid;
  const out = path.join(DATA_DIR, 'outputs', `${genId}.png`);
  fs.writeFileSync(out, PNG);
  fs.mkdirSync(path.join(DATA_DIR, 'uploads', String(genId)), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', String(genId), 'input_01.png'), PNG);
  db.prepare('UPDATE generations SET output_path = ? WHERE id = ?').run(out, genId);
  db.close();

  const retry = await call(`/api/generation/${genId}/retry`, { method: 'POST' });
  assert.equal(retry.status, 403, JSON.stringify(retry.json));
  assert.equal(retry.json.code, 'EMAIL_NOT_VERIFIED');
});

test('sans facturation, la suppression aboutit et efface les fichiers du disque', async () => {
  const out = path.join(DATA_DIR, 'outputs', `${genId}.png`);
  const inputDir = path.join(DATA_DIR, 'uploads', String(genId));
  assert.ok(fs.existsSync(out) && fs.existsSync(inputDir), 'mise en place : fichiers présents');

  const del = await call('/api/account/delete', { method: 'POST', body: { password: MDP } });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.generations, 1);
  assert.equal(del.json.files, 2, 'le visuel ET la photo déposée');
  assert.equal(del.json.billing.skipped, 'no_active_subscription');

  assert.equal(fs.existsSync(out), false, 'le visuel généré est effacé');
  assert.equal(fs.existsSync(inputDir), false, 'la photo déposée est effacée');

  const db = await openDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);
  assert.ok(row.deleted_at);
  assert.match(row.email, /^deleted\+\d+@account\.invalid$/);
  assert.equal(row.extra_credits, 0);
  const gen = db.prepare('SELECT * FROM generations WHERE id = ?').get(genId);
  assert.ok(gen, 'la ligne de consommation reste (trace comptable)');
  assert.equal(gen.cost_usd, 0.101);
  assert.equal(gen.output_path, null);
  assert.equal(gen.prompt_used, null);
  db.close();
});

test('une génération qui finit après la suppression ne réécrit rien et ne laisse aucun fichier', async () => {
  cookie = '';
  const r = await call('/api/auth/register', { method: 'POST', body: { email: CLIENT, password: MDP, acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const clientId = r.json.user.id;
  const db = await openDb();
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(clientId);
  db.close();

  const fd = new FormData();
  fd.append('brand', 'Torréfaction Ourthe');
  fd.append('category', 'snack');
  fd.append('theme', 'classique');
  fd.append('images', new Blob([PNG], { type: 'image/png' }), 'paquet.png');
  const pending = fetch(`${BASE}/api/generate`, { method: 'POST', headers: { Cookie: cookie, Origin: BASE }, body: fd });

  await n8nReached; // n8n a reçu la demande : la génération est en vol
  const del = await call('/api/account/delete', { method: 'POST', body: { password: MDP } });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  release();

  const gen = await pending;
  assert.equal(gen.status, 401, 'la génération orpheline est refusée');
  await gen.text();

  const db2 = await openDb();
  const rows = db2.prepare('SELECT * FROM generations WHERE user_id = ?').all(clientId);
  db2.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].output_path, null, 'rien de réécrit sur la ligne pseudonymisée');
  assert.equal(rows[0].prompt_used, null);
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'outputs', `${rows[0].id}.png`)), false, 'le visuel produit est effacé');
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'uploads', String(rows[0].id))), false, 'les photos déposées aussi');
});
