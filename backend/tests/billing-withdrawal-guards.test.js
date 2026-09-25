// Garde-fous de la rétractation : un contrat = un délai, jamais deux
// remboursements automatiques pour le même paiement, pas de remboursement de
// pack pendant qu'une génération tourne.
//
//   node --test tests/billing-withdrawal-guards.test.js
//
// Mode démo (aucune clé Stripe) : aucun appel réseau. Le garde-fou anti-abus
// (WITHDRAWAL_COOLDOWN_DAYS) est mis à 0 ici pour que seul le contrôle « même
// contrat » puisse envoyer une demande en `review` : sans ça, on ne saurait pas
// lequel des deux a joué.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-guards-'));
// store.js est importé DANS ce processus (écritures directes du journal) :
// db.js lit DATA_DIR à l'import, il doit viser la base du serveur.
process.env.DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = 'a'.repeat(48);
process.env.N8N_TOKEN = 'b'.repeat(32);
process.env.WITHDRAWAL_COOLDOWN_DAYS = '0';
const PORT = 3491;
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'ines@fromagerie-des-dunes.be';
const PASSWORD = 'Comte-24-mois-Affine!';

let server;
let cookie = '';
let store;

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

// Connexion courte, fermée à chaque fois : une connexion oubliée suffit à
// empêcher l'effacement du répertoire sous Windows.
async function sql(fn) {
  const db = new (await import('better-sqlite3')).default(path.join(DATA_DIR, 'app.db'));
  try { return fn(db); } finally { db.close(); }
}

const subRow = () => sql((db) => db.prepare('SELECT * FROM subscriptions WHERE user_id = 1').get());
const state = async () => (await call('/api/billing/withdrawal')).json;
// Une demande passée, datée de la veille : hors de la fenêtre anti-abus (0 j),
// seul le contrôle « même contrat » peut la voir.
async function pastWithdrawal(row, finish) {
  const id = store.insertWithdrawal({ user_id: 1, paid_cents: 2490, quota: 100, used: 0, billable: 0, refund_cents: 2490, status: 'pending', ...row });
  if (finish) store.finishWithdrawal(id, finish);
  await sql((db) => db.prepare("UPDATE withdrawals SET requested_at = datetime('now','-1 day') WHERE id = ?").run(id));
  return id;
}

before(async () => {
  server = spawn(process.execPath, ['--import', './tests/helpers/register.mjs', 'src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, NODE_ENV: 'development', DATA_DIR, PORT: String(PORT),
      SESSION_SECRET: 'a'.repeat(48), N8N_TOKEN: 'b'.repeat(32),
      BILLING_ENABLED: 'true', REGISTER_MODE: 'open', EMAIL_VERIFICATION: 'false',
      SMTP_HOST: '', ADMIN_EMAILS: '', SEED_USERS: '', EMAIL_HASH_PEPPER: 'c'.repeat(48),
      APP_ORIGINS: BASE, STRIPE_SECRET_KEY: '', WITHDRAWAL_COOLDOWN_DAYS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[serveur] ${d}`));
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) {
        // Après le démarrage : le serveur a migré la base (tables withdrawals…).
        store = await import('../src/billing/store.js');
        return;
      }
    } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('le serveur de test ne démarre pas');
});

after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGKILL');
    await exited;
  }
  try { (await import('../src/db.js')).default.close(); } catch { /* jamais ouverte */ }
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// --- Un contrat = un délai ----------------------------------------------------
let firstContract;

test('contrat conclu il y a 30 jours : hors délai', async () => {
  const reg = await call('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD, acceptTerms: true } });
  assert.equal(reg.status, 201);
  const ok = await call('/api/billing/checkout', { method: 'POST', body: { plan: 'pro', withdrawalConsent: true } });
  assert.equal(ok.status, 200);

  firstContract = (await subRow()).stripe_subscription_id;
  assert.match(firstContract, /^demo_1_/);
  await sql((db) => db.prepare("UPDATE subscriptions SET subscribed_at = datetime('now','-30 days') WHERE user_id = 1").run());

  const w = await state();
  assert.equal(w.subscription.eligible, false);
  assert.equal(w.subscription.reason, 'WINDOW_EXPIRED');
});

test('changement de formule et reconduction du MÊME abonnement : aucun délai rouvert', async () => {
  const before = (await subRow()).subscribed_at;

  // Changement de formule en cours de contrat : même identifiant, même date.
  const change = await call('/api/billing/checkout', { method: 'POST', body: { plan: 'studio', withdrawalConsent: true } });
  assert.equal(change.status, 200);
  let row = await subRow();
  assert.equal(row.plan_key, 'studio');
  assert.equal(row.stripe_subscription_id, firstContract, 'un changement de formule ne crée pas de contrat');
  assert.equal(row.subscribed_at, before);

  // Reconduction mensuelle (webhook Stripe) : même identifiant, nouvelle période.
  store.upsertSubscription({ ...row, period_start: '2026-11-01 09:00:00', period_end: '2026-12-01 09:00:00', subscribed_at: '2026-11-01 09:00:00' });
  row = await subRow();
  assert.equal(row.subscribed_at, before, 'la reconduction ne déplace pas la date de conclusion');
  assert.equal((await state()).subscription.reason, 'WINDOW_EXPIRED');
});

test('réabonnement après résiliation : NOUVEL identifiant, nouveau délai de 14 jours', async () => {
  assert.equal((await call('/api/billing/cancel', { method: 'POST' })).status, 200);
  const again = await call('/api/billing/checkout', { method: 'POST', body: { plan: 'pro', withdrawalConsent: true } });
  assert.equal(again.status, 200);

  const row = await subRow();
  assert.notEqual(row.stripe_subscription_id, firstContract, 'un réabonnement est un nouveau contrat');
  const w = await state();
  assert.equal(w.subscription.eligible, true, JSON.stringify(w.subscription));
  assert.equal(w.subscription.reason, null);
  assert.equal(w.subscription.daysLeft, 14);
  assert.equal(w.subscription.manualReview, false);
});

test('même mécanique côté webhook : un autre identifiant Stripe écrit sa propre date', () => {
  const cur = store.getSubscription(1);
  store.upsertSubscription({ ...cur, stripe_subscription_id: 'sub_test_B', subscribed_at: '2026-09-20 08:00:00' });
  assert.equal(store.getSubscription(1).subscribed_at, '2026-09-20 08:00:00');
  store.upsertSubscription({ ...store.getSubscription(1), subscribed_at: '2026-10-20 08:00:00' });
  assert.equal(store.getSubscription(1).subscribed_at, '2026-09-20 08:00:00', 'même identifiant : date inchangée');
  // Remise en état pour la suite : le contrat démo courant.
  store.upsertSubscription({ ...cur });
});

// --- Jamais deux remboursements automatiques pour le même contrat ------------
test('une demande en échec sur un AUTRE contrat ne change rien', async () => {
  await pastWithdrawal({ kind: 'subscription', stripe_subscription_id: firstContract }, { status: 'failed', error: 'test' });
  const w = await state();
  assert.equal(w.subscription.eligible, true);
  assert.equal(w.subscription.manualReview, false);
});

test('déjà remboursée sur CE contrat : la nouvelle demande part en revue, sans refus', async () => {
  const contract = (await subRow()).stripe_subscription_id;
  await pastWithdrawal({ kind: 'subscription', stripe_subscription_id: contract }, { status: 'refunded', stripe_refund_id: 're_test_deja' });

  const w = await state();
  assert.equal(w.subscription.eligible, true, 'le droit n’est jamais refusé');
  assert.equal(w.subscription.manualReview, true, 'l’utilisateur est prévenu AVANT de confirmer');

  const post = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'subscription', expectedRefundCents: w.subscription.refundCents } });
  assert.equal(post.status, 200, JSON.stringify(post.json));
  assert.equal(post.json.status, 'review');

  const row = store.getWithdrawal(post.json.id);
  assert.equal(row.status, 'review');
  assert.equal(row.stripe_subscription_id, contract);
  assert.equal((await subRow()).status, 'active', 'rien n’est exécuté automatiquement : l’exploitant reprend la main');
});

test('en échec sur CE contrat (remboursement peut-être parti) : revue aussi', async () => {
  // Contrat neuf, pour ne dépendre d'aucune demande précédente. La demande
  // `review` du test précédent est datée de la seconde en cours : on la vieillit
  // pour qu'elle sorte de la fenêtre anti-abus (0 j, bornée à la seconde).
  await sql((db) => db.prepare("UPDATE withdrawals SET requested_at = datetime('now','-1 day')").run());
  await call('/api/billing/cancel', { method: 'POST' });
  await call('/api/billing/checkout', { method: 'POST', body: { plan: 'pro', withdrawalConsent: true } });
  const contract = (await subRow()).stripe_subscription_id;
  assert.equal((await state()).subscription.manualReview, false, 'contrat neuf : traitement automatique');

  // Réponse de Stripe perdue : `failed`, sans identifiant de remboursement.
  await pastWithdrawal({ kind: 'subscription', stripe_subscription_id: contract }, { status: 'failed', error: 'délai dépassé' });

  const w = await state();
  assert.equal(w.subscription.manualReview, true);
  const post = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'subscription', expectedRefundCents: w.subscription.refundCents } });
  assert.equal(post.status, 200, JSON.stringify(post.json));
  assert.equal(post.json.status, 'review');
});

// --- Pack : pas pendant une génération, pas deux fois -------------------------
test('pack : rétractation refusée tant qu’une génération est en cours', async () => {
  const buy = await call('/api/billing/pack', { method: 'POST', body: { withdrawalConsent: true } });
  assert.equal(buy.status, 200);
  assert.equal((await state()).pack.eligible, true);

  const genId = await sql((db) => db
    .prepare("INSERT INTO generations (user_id, brand, category, theme, status, created_at) VALUES (1,'Fromagerie des Dunes','Alimentaire','classique','pending',datetime('now'))")
    .run().lastInsertRowid);

  const w = await state();
  assert.equal(w.pack.eligible, false);
  assert.equal(w.pack.reason, 'GENERATIONS_PENDING');

  const post = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'pack' } });
  assert.equal(post.status, 409);
  assert.equal(post.json.code, 'GENERATIONS_PENDING');
  assert.match(post.json.error, /génération/i);
  assert.equal(await sql((db) => db.prepare('SELECT extra_credits c FROM users WHERE id = 1').get().c), 20, 'aucun crédit retiré');

  // Génération terminée (ici en échec) : la rétractation redevient possible.
  await sql((db) => db.prepare("UPDATE generations SET status = 'error' WHERE id = ?").run(genId));
  assert.equal((await state()).pack.eligible, true);
});

test('pack : une ligne `pending` orpheline (serveur arrêté) ne bloque pas le droit', async () => {
  await sql((db) => db
    .prepare("INSERT INTO generations (user_id, brand, category, theme, status, created_at) VALUES (1,'Fromagerie des Dunes','Alimentaire','classique','pending',datetime('now','-2 days'))")
    .run());
  const w = await state();
  assert.equal(w.pack.eligible, true, JSON.stringify(w.pack));
  assert.equal(w.pack.reason, null);
});

test('pack : demande en échec sur CE pack → revue, crédits intacts', async () => {
  const pack = (await state()).pack;
  await pastWithdrawal({ kind: 'pack', paid_cents: 600, refund_cents: 600, credit_purchase_id: pack.purchaseId }, { status: 'failed', error: 'test' });

  const w = await state();
  assert.equal(w.pack.manualReview, true);
  const post = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'pack', expectedRefundCents: w.pack.refundCents } });
  assert.equal(post.status, 200, JSON.stringify(post.json));
  assert.equal(post.json.status, 'review');
  assert.equal(store.getWithdrawal(post.json.id).credit_purchase_id, pack.purchaseId);
  assert.equal(await sql((db) => db.prepare('SELECT extra_credits c FROM users WHERE id = 1').get().c), 20, 'rien retiré automatiquement');
});

// --- Achat de pack idempotent -------------------------------------------------
test('pack rejoué (même session Stripe) : crédité une seule fois', () => {
  const before = store.getUser(1).extra_credits;
  const row = { user_id: 1, credits: 20, paid_cents: 600, stripe_session_id: 'cs_test_rejeu', stripe_payment_intent: 'pi_test_rejeu' };
  assert.ok(store.creditPack(row), 'premier passage : achat tracé');
  assert.equal(store.creditPack(row), null, 'rejeu : ignoré');
  assert.equal(store.getUser(1).extra_credits, before + 20);
});
