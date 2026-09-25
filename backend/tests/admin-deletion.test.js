// La suppression déclenchée depuis la console d'administration doit produire
// EXACTEMENT le même état que celle demandée par l'utilisateur.
//
//   node --test tests/admin-deletion.test.js
//
// Elle faisait auparavant un `DELETE FROM users` sec : la cascade SQL emportait
// les lignes `generations`, donc la trace comptable que l'exploitant demande de
// conserver. Ce fichier verrouille la correction.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-admindel-'));
const PORT = 3462;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'patronne@adcraft.be';
const VICTIME = 'contact@savonnerie-lys.fr';
const MDP = 'Lavande-Sechee-2026!';

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

before(async () => {
  server = spawn(process.execPath, ['--import', './tests/helpers/register.mjs', 'src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, NODE_ENV: 'development', DATA_DIR, PORT: String(PORT),
      SESSION_SECRET: 'a'.repeat(48), N8N_TOKEN: 'b'.repeat(32),
      BILLING_ENABLED: 'true', REGISTER_MODE: 'open', EMAIL_VERIFICATION: 'false',
      SMTP_HOST: '', ADMIN_EMAILS: ADMIN, SEED_USERS: '', EMAIL_HASH_PEPPER: 'c'.repeat(48),
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
  // Attendre la MORT du serveur avant d'effacer : sous Windows, la base encore
  // ouverte par le processus enfant fait échouer rmSync en EPERM.
  if (server && server.exitCode === null && server.signalCode === null) {
    await new Promise((r) => { server.once('exit', r); server.kill('SIGKILL'); });
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let victimeId;

test('mise en place : un admin, un client, trois générations', async () => {
  const v = await call('/api/auth/register', { method: 'POST', body: { email: VICTIME, password: MDP, acceptTerms: true } });
  assert.equal(v.status, 201);
  victimeId = v.json.user.id;

  const db = await openDb();
  const ins = db.prepare("INSERT INTO generations (user_id, brand, category, theme, status, cost_usd, prompt_used, description) VALUES (?,'Savonnerie Lys','Cosmétique','luxe','done',0.101,'un prompt complet','une description saisie par la cliente')");
  for (let i = 0; i < 3; i += 1) ins.run(victimeId);
  db.close();

  cookie = '';
  const a = await call('/api/auth/register', { method: 'POST', body: { email: ADMIN, password: MDP, acceptTerms: true } });
  assert.equal(a.status, 201);
  assert.equal(a.json.user.isAdmin, true, "ADMIN_EMAILS promeut dès la création");
});

test('la liste normale ne montre pas les comptes désactivés, ?deleted=1 si', async () => {
  const actifs = await call('/api/admin/users');
  assert.equal(actifs.status, 200);
  assert.equal(actifs.json.users.filter((u) => u.deletedAt).length, 0);

  const supprimes = await call('/api/admin/users?deleted=1');
  assert.equal(supprimes.json.deleted, true);
  assert.equal(supprimes.json.users.length, 0, 'aucun compte supprimé pour l’instant');
});

test('la suppression admin pseudonymise au lieu de détruire', async () => {
  const del = await call(`/api/admin/users/${victimeId}`, { method: 'DELETE' });
  assert.equal(del.status, 200, JSON.stringify(del.json));

  const db = await openDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(victimeId);
  assert.ok(row, 'la ligne existe toujours');
  assert.ok(row.deleted_at);
  assert.match(row.email, /@account\.invalid$/);
  assert.ok(row.email_hash);
  assert.equal(row.deletion_reason, 'supprimé par un administrateur');

  // LE point du test : la trace comptable survit.
  const gens = db.prepare('SELECT * FROM generations WHERE user_id = ?').all(victimeId);
  assert.equal(gens.length, 3, 'les lignes de consommation sont conservées');
  assert.equal(gens[0].cost_usd, 0.101, 'le coût reste, c’est lui la trace');
  assert.equal(gens[0].brand, 'Savonnerie Lys');
  // …mais le texte libre saisi par la personne est parti.
  assert.equal(gens[0].prompt_used, null);
  assert.equal(gens[0].description, null);
  assert.equal(gens[0].output_path, null);
  db.close();
});

test('le compte supprimé est consultable par l’admin, et lui seul', async () => {
  const supprimes = await call('/api/admin/users?deleted=1');
  assert.equal(supprimes.json.users.length, 1);
  assert.equal(supprimes.json.users[0].id, victimeId);
  assert.ok(supprimes.json.users[0].deletedAt);

  const actifs = await call('/api/admin/users');
  assert.equal(actifs.json.users.filter((u) => u.id === victimeId).length, 0);

  // Vue d'ensemble : le compte sort des totaux, mais reste compté à part.
  const o = await call('/api/admin/overview');
  assert.equal(o.json.deleted.total, 1);
});

test('aucune action administrative ne ressuscite un compte supprimé', async () => {
  for (const [p, body] of [
    [`/api/admin/users/${victimeId}/credits`, { credits: 10 }],
    [`/api/admin/users/${victimeId}/unlock`, null],
    [`/api/admin/users/${victimeId}/verify`, null],
  ]) {
    const r = await call(p, { method: 'POST', body });
    assert.equal(r.status, 404, `${p} devrait répondre 404`);
  }
  const reDel = await call(`/api/admin/users/${victimeId}`, { method: 'DELETE' });
  assert.equal(reDel.status, 404, 'supprimer deux fois ne doit rien faire');
});

test("un compte administrateur n'est pas supprimable depuis la console", async () => {
  const db = await openDb();
  const adminId = db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
  db.close();
  const r = await call(`/api/admin/users/${adminId}`, { method: 'DELETE' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /ADMIN_EMAILS/);
});
