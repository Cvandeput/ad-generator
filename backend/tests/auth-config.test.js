// GET /api/auth/config expose le quota gratuit (freeQuota), que le front
// affiche en « 5 visuels offerts, sans carte bancaire ».
//
//   node --test tests/auth-config.test.js
//
// Deux serveurs : l'un avec facturation et FREE_PLAN_QUOTA=7 (la valeur
// annoncée doit être celle que la grille applique), l'autre sans facturation
// ni FREE_PLAN_QUOTA (valeur par défaut, 5). Dans les deux cas, les autres
// champs de la réponse restent inchangés.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = [];

async function startServer(port, extraEnv) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-authcfg-'));
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['--import', './tests/helpers/register.mjs', 'src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, NODE_ENV: 'development', DATA_DIR: dataDir, PORT: String(port),
      SESSION_SECRET: 'a'.repeat(48), N8N_TOKEN: 'b'.repeat(32),
      REGISTER_MODE: 'open', EMAIL_VERIFICATION: 'false', SMTP_HOST: '', STRIPE_SECRET_KEY: '',
      ADMIN_EMAILS: '', SEED_USERS: '', EMAIL_HASH_PEPPER: 'c'.repeat(48),
      APP_ORIGINS: base,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(`[serveur ${port}] ${d}`));
  started.push({ proc, dataDir });
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return base; } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`le serveur de test (${port}) ne démarre pas`);
}

after(async () => {
  // Attendre la MORT de chaque serveur avant d'effacer : sous Windows, la base
  // encore ouverte par le processus enfant fait échouer rmSync en EPERM.
  for (const { proc, dataDir } of started) {
    if (proc.exitCode === null && proc.signalCode === null) {
      await new Promise((r) => { proc.once('exit', r); proc.kill('SIGKILL'); });
    }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const getJson = async (url) => {
  const res = await fetch(url);
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('freeQuota reprend FREE_PLAN_QUOTA, comme la grille des formules', async () => {
  const base = await startServer(3537, { BILLING_ENABLED: 'true', FREE_PLAN_QUOTA: '7' });

  const cfg = await getJson(`${base}/api/auth/config`);
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.freeQuota, 7);
  // Rien d'autre ne change dans la réponse.
  assert.deepEqual(Object.keys(cfg.json).sort(), ['emailVerification', 'freeQuota', 'registerMode', 'termsVersion']);
  assert.equal(cfg.json.registerMode, 'open');
  assert.equal(cfg.json.emailVerification, false);

  // Même valeur que celle que la facturation applique réellement.
  const plans = await getJson(`${base}/api/billing/plans`);
  assert.equal(plans.status, 200);
  assert.equal(plans.json.plans.find((p) => p.key === 'free').quota, cfg.json.freeQuota);
});

test('freeQuota vaut 5 par défaut, facturation désactivée comprise', async () => {
  const base = await startServer(3538, { BILLING_ENABLED: 'false', FREE_PLAN_QUOTA: '' });

  const cfg = await getJson(`${base}/api/auth/config`);
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.freeQuota, 5);
  assert.equal((await getJson(`${base}/api/billing/plans`)).status, 404, 'la facturation reste désactivée');
});

test('une adresse déjà inscrite est signalée clairement, sans ouvrir de session', async () => {
  const base = await startServer(3539, { BILLING_ENABLED: 'false' });
  const register = (password) =>
    fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ email: 'deja.inscrite@example.com', password, acceptTerms: true }),
    });

  const first = await register('Premier-Essai-2026!');
  assert.equal(first.status, 201);

  // Même adresse, autre mot de passe : 409 explicite (plus de 202 « neutre »
  // qui renvoyait vers la connexion), et surtout aucune session ouverte.
  const again = await register('Second-Essai-2026!');
  assert.equal(again.status, 409);
  const body = await again.json();
  assert.equal(body.code, 'EMAIL_TAKEN');
  assert.equal(body.user, undefined);
  assert.equal(again.headers.get('set-cookie'), null, 'aucun cookie de session');
});
