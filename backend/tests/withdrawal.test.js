// VÉRIF 1bis — parcours complet de rétractation contre un vrai serveur.
//
//   node --test tests/withdrawal.test.js
//
// prorata.test.js vérifie le calcul isolé ; ici on vérifie la chaîne : refus
// d'achat sans consentement, horodatage du consentement, montant annoncé,
// exécution, résiliation, et trace en base. Mode démo (pas de clé Stripe),
// donc aucun appel réseau.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-withdraw-'));
// Le dernier test importe store.js DANS ce processus pour exercer le vrai
// upsertSubscription. db.js lit DATA_DIR à l'import : il doit donc pointer sur
// la même base que le serveur, sinon l'import ouvre une base vide sans tables.
// SQLite est en mode WAL, deux processus peuvent l'ouvrir ensemble.
process.env.DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = 'a'.repeat(48);
process.env.N8N_TOKEN = 'b'.repeat(32);
const PORT = 3461;
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'marc@brasserie-du-port.be';
const PASSWORD = 'Houblon-Saison-2026!';

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
      SMTP_HOST: '', ADMIN_EMAILS: '', SEED_USERS: '', EMAIL_HASH_PEPPER: 'c'.repeat(48),
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

// Sous Windows, un fichier ouvert ne peut pas être effacé : il faut attendre la
// SORTIE du serveur (kill() n'attend rien) et fermer la connexion que l'import
// de store.js a ouverte dans ce processus, sinon rmSync échoue en EPERM.
after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGKILL');
    await exited;
  }
  try { (await import('../src/db.js')).default.close(); } catch { /* jamais ouverte */ }
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("l'abonnement est REFUSÉ sans consentement exprès", async () => {
  const reg = await call('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD, acceptTerms: true } });
  assert.equal(reg.status, 201);

  const sans = await call('/api/billing/checkout', { method: 'POST', body: { plan: 'pro' } });
  assert.equal(sans.status, 400);
  assert.equal(sans.json.code, 'WITHDRAWAL_CONSENT_REQUIRED');

  // Rien n'a été souscrit, et surtout : aucun consentement n'a été écrit.
  const db = await openDb();
  assert.equal(db.prepare('SELECT withdrawal_consent_at c FROM users WHERE id = 1').get().c, null);
  db.close();
});

test('avec consentement : abonnement actif et consentement horodaté + versionné', async () => {
  const ok = await call('/api/billing/checkout', { method: 'POST', body: { plan: 'pro', withdrawalConsent: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.demo, true);

  const db = await openDb();
  const u = db.prepare('SELECT withdrawal_consent_at, withdrawal_consent_version, withdrawal_consent_ip FROM users WHERE id = 1').get();
  assert.ok(u.withdrawal_consent_at, 'le consentement est horodaté');
  assert.ok(u.withdrawal_consent_version, 'la version du texte accepté est conservée');
  assert.ok(u.withdrawal_consent_ip, "l'IP est conservée");
  const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = 1').get();
  assert.equal(sub.plan_key, 'pro');
  assert.ok(sub.subscribed_at, 'la date de conclusion est posée');
  db.close();
});

test('0 consommé : le remboursement annoncé est intégral', async () => {
  const w = await call('/api/billing/withdrawal');
  assert.equal(w.status, 200);
  assert.equal(w.json.subscription.eligible, true);
  assert.equal(w.json.subscription.refundCents, 2490);
  assert.equal(w.json.subscription.consented, true);
  assert.equal(w.json.subscription.daysLeft, 14, 'un délai de 14 jours affiche 14, pas 15');
});

test('60 générations consommées : le remboursement annoncé passe à 9,96 €', async () => {
  const db = await openDb();
  const sub = db.prepare('SELECT period_start FROM subscriptions WHERE user_id = 1').get();
  const ins = db.prepare("INSERT INTO generations (user_id, brand, category, theme, status, cost_usd, created_at) VALUES (1,'Brasserie du Port','Boisson','classique','done',0.101,?)");
  for (let i = 0; i < 60; i += 1) ins.run(sub.period_start);
  db.close();

  const w = await call('/api/billing/withdrawal');
  assert.equal(w.json.subscription.used, 60);
  assert.equal(w.json.subscription.quota, 100);
  assert.equal(w.json.subscription.billable, 60);
  assert.equal(w.json.subscription.refundCents, 996);
  assert.equal(w.json.subscription.retainedCents, 1494);
});

test('un montant périmé est refusé au lieu d’être remboursé', async () => {
  // Le cas réel : l'onglet est resté ouvert pendant que des générations
  // tournaient. Rembourser le montant affiché il y a une heure serait faux.
  const bad = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'subscription', expectedRefundCents: 2490 } });
  assert.equal(bad.status, 409);
  assert.equal(bad.json.code, 'AMOUNT_CHANGED');
  assert.equal(bad.json.state.refundCents, 996, 'la réponse porte le montant à jour');
});

test('la rétractation aboutit, résilie et laisse une trace justifiable', async () => {
  const done = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'subscription', expectedRefundCents: 996 } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.status, 'simulated', 'mode démo : aucun appel à Stripe');
  assert.equal(done.json.refundCents, 996);

  const db = await openDb();
  const row = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(done.json.id);
  // Le calcul est FIGÉ : il doit rester justifiable même si le quota, le prix
  // ou la consommation changent après coup.
  assert.equal(row.paid_cents, 2490);
  assert.equal(row.quota, 100);
  assert.equal(row.used, 60);
  assert.equal(row.billable, 60);
  assert.equal(row.refund_cents, 996);
  assert.ok(row.consent_at, 'le consentement invoqué est recopié dans la trace');
  assert.ok(row.deadline);
  assert.ok(row.ip);
  assert.ok(row.processed_at);

  assert.equal(db.prepare('SELECT status FROM subscriptions WHERE user_id = 1').get().status, 'canceled');
  db.close();
});

test("l'accès est révoqué : le quota retombe à zéro", async () => {
  const sub = await call('/api/billing/subscription');
  assert.notEqual(sub.json.status, 'active');
  // Plan gratuit à vie, 5 générations, mais 60 déjà consommées depuis la
  // création du compte : il ne reste rien. L'accès est bien coupé.
  assert.equal(sub.json.exhausted, true);
  assert.equal(sub.json.remaining, 0);
});

test('plus aucune rétractation possible sans contrat en cours', async () => {
  const w = await call('/api/billing/withdrawal');
  assert.equal(w.json.subscription.eligible, false);
  assert.equal(w.json.subscription.reason, 'NO_SUBSCRIPTION');

  const post = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'subscription' } });
  assert.equal(post.status, 409);
  assert.equal(post.json.code, 'NO_SUBSCRIPTION');
});

// --- Pack de crédits : régime distinct ---------------------------------------
test('un pack ouvre sa PROPRE fenêtre de rétractation', async () => {
  const buy = await call('/api/billing/pack', { method: 'POST', body: { withdrawalConsent: true } });
  assert.equal(buy.status, 200);

  const w = await call('/api/billing/withdrawal');
  assert.equal(w.json.pack.eligible, true, "le pack est éligible même si l'abonnement ne l'est plus");
  assert.equal(w.json.pack.credits, 20);
  assert.equal(w.json.pack.refundableCredits, 20);
  assert.equal(w.json.pack.refundCents, 600, '20 crédits sur 20 inutilisés → 6,00 €');
});

test('le pack est remboursé au prorata des crédits NON utilisés', async () => {
  // 5 crédits consommés : il en reste 15 sur 20 → 15/20 × 6,00 € = 4,50 €.
  const db = await openDb();
  db.prepare('UPDATE users SET extra_credits = 15 WHERE id = 1').run();
  db.close();

  const w = await call('/api/billing/withdrawal');
  assert.equal(w.json.pack.refundableCredits, 15);
  assert.equal(w.json.pack.refundCents, 450);

  const done = await call('/api/billing/withdrawal', { method: 'POST', body: { kind: 'pack', expectedRefundCents: 450 } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.refundCents, 450);

  const db2 = await openDb();
  assert.equal(db2.prepare('SELECT extra_credits c FROM users WHERE id = 1').get().c, 0, 'les crédits remboursés sont retirés');
  assert.ok(db2.prepare('SELECT withdrawn_at w FROM credit_purchases WHERE id = 1').get().w, 'le pack est marqué rétracté');
  db2.close();
});

test("une reconduction mensuelle ne rouvre PAS 14 jours de rétractation", async () => {
  // C'est l'invariant le plus coûteux du chantier : si `subscribed_at` suivait
  // `period_start`, chaque mois rendrait l'abonné de nouveau rétractable, à vie.
  const db = await openDb();
  const before = db.prepare('SELECT subscribed_at FROM subscriptions WHERE user_id = 1').get().subscribed_at;
  db.close();

  const { upsertSubscription, getSubscription } = await import('../src/billing/store.js');
  const cur = getSubscription(1);
  // Renouvellement : nouvelle période, un mois plus tard.
  upsertSubscription({ ...cur, status: 'active', period_start: '2026-10-17 09:00:00', period_end: '2026-11-17 09:00:00', subscribed_at: '2026-10-17 09:00:00' });

  const db2 = await openDb();
  assert.equal(db2.prepare('SELECT subscribed_at FROM subscriptions WHERE user_id = 1').get().subscribed_at, before,
    'la date de conclusion ne bouge pas à la reconduction');
  db2.close();
});

test("un échec APRÈS le remboursement ne doit pas effacer l'identifiant du virement", async () => {
  // Scénario réel : refunds.create réussit, puis subscriptions.cancel échoue.
  // Si `finishWithdrawal` écrasait stripe_refund_id avec NULL, l'exploitant
  // reprendrait le dossier à la main et rembourserait une seconde fois.
  const { insertWithdrawal, attachRefund, finishWithdrawal, getWithdrawal } = await import('../src/billing/store.js');
  const id = insertWithdrawal({
    user_id: 1, kind: 'subscription', paid_cents: 2490, quota: 100, used: 60,
    billable: 60, refund_cents: 996, status: 'pending',
  });
  attachRefund(id, 're_test_123', 'pi_test_456');
  finishWithdrawal(id, { status: 'failed', error: 'résiliation Stripe refusée' });

  const row = getWithdrawal(id);
  assert.equal(row.status, 'failed');
  assert.equal(row.stripe_refund_id, 're_test_123', "l'argent est parti, la trace doit rester");
  assert.equal(row.stripe_payment_intent, 'pi_test_456');
  assert.match(row.error, /résiliation/);
});
