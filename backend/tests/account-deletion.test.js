// VÉRIF 2 — suppression de compte : ce qui doit devenir impossible après coup.
//
//   node --test tests/account-deletion.test.js
//
// Test de bout en bout contre un vrai serveur et une vraie base SQLite : les
// filtres `deleted_at IS NULL` sont disséminés dans une quinzaine de requêtes,
// et c'est exactement le genre d'invariant qu'une relecture ne garantit pas.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-delete-'));
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;

const EMAIL = 'claire.dubois@boulangerie-des-halles.be';
const PASSWORD = 'Brioche-Vapeur-2026!';

let server;
let cookie = '';

const jar = (res) => {
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const v = c.split(';')[0];
    if (v.split('=')[1]) cookie = v;
  }
};

async function call(pathname, { method = 'GET', body, useCookie = true } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(useCookie && cookie ? { Cookie: cookie } : {}),
      Origin: BASE,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') || '' };
}

before(async () => {
  // --import : installe le hook qui remplace `shared/prompt.mjs` par une
  // doublure SI le fichier est absent (copie de travail partielle). Sur le
  // dépôt complet, le hook est transparent.
  server = spawn(process.execPath, ['--import', './tests/helpers/register.mjs', 'src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DATA_DIR,
      PORT: String(PORT),
      SESSION_SECRET: 'a'.repeat(48),
      N8N_TOKEN: 'b'.repeat(32),
      BILLING_ENABLED: 'true',
      REGISTER_MODE: 'open',
      EMAIL_VERIFICATION: 'false',
      SMTP_HOST: '',
      ADMIN_EMAILS: '',
      SEED_USERS: '',
      FREE_PLAN_QUOTA: '5',
      EMAIL_HASH_PEPPER: 'c'.repeat(48),
      APP_ORIGINS: BASE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[serveur] ${d}`));

  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('le serveur de test ne démarre pas');
});

after(async () => {
  // Attendre la MORT du serveur avant d'effacer : sous Windows, la base encore
  // ouverte par le processus enfant fait échouer rmSync en EPERM.
  if (server && server.exitCode === null && server.signalCode === null) {
    await new Promise((r) => { server.once('exit', r); server.kill('SIGKILL'); });
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('un compte fraîchement créé a son quota gratuit et répond sur /me', async () => {
  const r = await call('/api/auth/register', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD, acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));

  const me = await call('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, EMAIL);

  const sub = await call('/api/billing/subscription');
  assert.equal(sub.json.quota, 5, 'le premier compte reçoit bien les 5 générations offertes');
});

test('la suppression exige le bon mot de passe', async () => {
  const bad = await call('/api/account/delete', { method: 'POST', body: { password: 'pas-le-bon' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.code, 'BAD_PASSWORD');

  // Le compte est toujours là : un échec de ré-authentification ne supprime rien.
  const me = await call('/api/auth/me');
  assert.equal(me.status, 200);
});

test('la suppression aboutit et révoque la session en cours', async () => {
  const del = await call('/api/account/delete', {
    method: 'POST',
    body: { password: PASSWORD, reason: 'Je ne publie plus sur les réseaux' },
  });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(del.json.ok, true);

  const me = await call('/api/auth/me');
  assert.equal(me.status, 401, 'la session de la suppression ne survit pas');
});

test('un compte supprimé ne peut plus se connecter', async () => {
  cookie = '';
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  assert.equal(login.status, 401, JSON.stringify(login.json));
  assert.match(login.json.error, /incorrect/i);
});

test("l'adresse ne redonne pas droit à un quota gratuit", async () => {
  cookie = '';
  const again = await call('/api/auth/register', {
    method: 'POST',
    body: { email: EMAIL, password: 'Autre-Mot-De-Passe-2026!', acceptTerms: true },
  });
  assert.equal(again.status, 201, "recréer un compte reste un droit : c'est le quota qui est déchu");

  const sub = await call('/api/billing/subscription');
  assert.equal(sub.json.quota, 0, 'quota gratuit déchu pour une adresse déjà supprimée');
  assert.equal(sub.json.exhausted, true);
  assert.equal(sub.json.remaining, 0);
});

test("la base ne contient plus l'adresse supprimée, mais garde son empreinte", async () => {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(path.join(DATA_DIR, 'app.db'), { readonly: true });
  const gone = db.prepare('SELECT * FROM users WHERE deleted_at IS NOT NULL').all();
  assert.equal(gone.length, 1);
  const row = gone[0];
  assert.notEqual(row.email, EMAIL, "l'adresse d'origine ne doit plus figurer en clair");
  assert.match(row.email, /@account\.invalid$/);
  assert.ok(row.email_hash && row.email_hash.length === 64, "l'empreinte est conservée");
  assert.ok(!String(row.email_hash).includes(EMAIL));
  assert.equal(row.terms_accepted_at, null);
  assert.equal(row.extra_credits, 0);
  // La ligne survit : c'est la trace comptable réclamée par l'exploitant.
  assert.ok(row.created_at, 'la date de création reste');
  db.close();
});

test("le nouveau compte n'a pas récupéré l'historique de l'ancien", async () => {
  const hist = await call('/api/history?status=done');
  assert.equal(hist.status, 200);
  assert.equal((hist.json.items || []).length, 0);
});

// --- VÉRIF 3 — la page 404 et le JSON des routes d'API ----------------------
test('une page inconnue renvoie la page 404 en HTML', async () => {
  const res = await fetch(`${BASE}/page-qui-nexiste-pas`, { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.match(html, /data-i18n="notFound\.title"/, 'la page 404 est bien instrumentée i18n');
});

test('/api/inexistant renvoie du JSON, jamais la page HTML', async () => {
  // Accept: text/html EXPRÈS — c'est ce qu'envoie un navigateur, et c'est le
  // cas qui casse quand error_page 404 est posé trop large côté nginx.
  const res = await fetch(`${BASE}/api/inexistant`, { headers: { Accept: 'text/html' } });
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
  const body = await res.json();
  assert.equal(body.error, 'Introuvable');
});
