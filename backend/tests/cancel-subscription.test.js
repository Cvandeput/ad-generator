// Résiliation Stripe à la suppression de compte (deletion.js,
// cancelSubscription) — test unitaire, en processus, contre une doublure du
// paquet `stripe` (tests/helpers/stripe-fake.mjs) : aucun appel réseau.
//
//   node --test tests/cancel-subscription.test.js
//
// Ce qui est verrouillé : un abonnement de démo n'est jamais envoyé à Stripe ;
// Stripe fait foi sur la copie locale ; « inexistant » et « déjà résilié »
// comptent comme des succès ; toute autre erreur bloque la suppression.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-cancel-'));
// Avant tout import de src/ : db.js lit DATA_DIR au chargement.
process.env.DATA_DIR = DATA_DIR;
process.env.STRIPE_SECRET_KEY = 'sk_test_doublure';
register('./helpers/stripe-fake-hooks.mjs', import.meta.url);

const calls = [];
const fake = {
  subs: [], // ce que renvoie subscriptions.list
  cancelError: null, // (id) => erreur à lever, ou null
  retrieveStatus: {}, // id → statut renvoyé par retrieve
  subscriptions: {
    list(params) {
      calls.push(['list', params]);
      const subs = fake.subs;
      return (async function* () { yield* subs; })();
    },
    async cancel(id) {
      calls.push(['cancel', id]);
      const err = fake.cancelError?.(id);
      if (err) throw err;
      return { id, status: 'canceled' };
    },
    async retrieve(id) {
      calls.push(['retrieve', id]);
      return { id, status: fake.retrieveStatus[id] ?? 'active' };
    },
  },
};
globalThis.__stripeFake = fake;

let db;
let store;
let cancelSubscription;

before(async () => {
  db = (await import('../src/db.js')).default;
  store = await import('../src/billing/store.js');
  store.migrate(); // la table subscriptions, comme avec BILLING_ENABLED=true
  ({ cancelSubscription } = await import('../src/deletion.js'));
});

after(() => {
  db?.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(() => {
  calls.length = 0;
  fake.subs = [];
  fake.cancelError = null;
  fake.retrieveStatus = {};
});

let n = 0;
function client({ customer = null, sub = null } = {}) {
  n += 1;
  const id = db
    .prepare('INSERT INTO users (email, password_hash, stripe_customer_id) VALUES (?, ?, ?)')
    .run(`client${n}@exemple.be`, 'x', customer).lastInsertRowid;
  if (sub) {
    store.upsertSubscription({
      user_id: id, stripe_subscription_id: sub.id, plan_key: 'pro', status: sub.status,
      quota_month: 50, period_start: null, period_end: null, cancel_at_period_end: 0,
    });
  }
  return id;
}
const localStatus = (id) => store.getSubscription(id)?.status;
const stripeError = (code) => Object.assign(new Error(`erreur Stripe ${code}`), { code });

test("un abonnement de démonstration (demo_…) n'est jamais envoyé à Stripe", async () => {
  const id = client({ sub: { id: 'demo_1_pro', status: 'active' } });
  const r = await cancelSubscription(id);
  assert.deepEqual(calls, [], 'aucun appel Stripe');
  assert.equal(r.canceled, true);
  assert.equal(r.demo, true);
  assert.equal(localStatus(id), 'canceled');
});

test('Stripe fait foi : tout abonnement non terminé du client est résilié, une seule fois', async () => {
  const id = client({ customer: 'cus_A', sub: { id: 'sub_1', status: 'active' } });
  fake.subs = [
    { id: 'sub_1', status: 'active' },
    { id: 'sub_2', status: 'canceled' },
    { id: 'sub_3', status: 'past_due' }, // absent de la copie locale (webhook manqué)
    { id: 'sub_4', status: 'incomplete_expired' },
    { id: 'sub_5', status: 'unpaid' },
  ];
  const r = await cancelSubscription(id);
  assert.deepEqual(calls[0], ['list', { customer: 'cus_A', status: 'all', limit: 100 }]);
  assert.deepEqual(calls.filter((c) => c[0] === 'cancel').map((c) => c[1]), ['sub_1', 'sub_3', 'sub_5']);
  assert.deepEqual(r.subscriptionIds, ['sub_1', 'sub_3', 'sub_5']);
  assert.equal(r.demo, undefined);
  assert.equal(localStatus(id), 'canceled');
});

test('abonnement inexistant chez Stripe (resource_missing) : succès, marqué résilié', async () => {
  const id = client({ sub: { id: 'sub_9', status: 'active' } });
  fake.cancelError = () => stripeError('resource_missing');
  const r = await cancelSubscription(id);
  assert.equal(r.canceled, true);
  assert.equal(localStatus(id), 'canceled');
});

test('abonnement déjà résilié chez Stripe : succès, marqué résilié', async () => {
  const id = client({ sub: { id: 'sub_10', status: 'active' } });
  fake.cancelError = () => stripeError('invalid_request');
  fake.retrieveStatus.sub_10 = 'canceled';
  const r = await cancelSubscription(id);
  assert.equal(r.canceled, true);
  assert.equal(localStatus(id), 'canceled');
});

test('toute autre erreur Stripe est propagée et ne marque rien', async () => {
  const id = client({ sub: { id: 'sub_11', status: 'active' } });
  fake.cancelError = () => stripeError('api_error');
  await assert.rejects(cancelSubscription(id), /api_error/);
  assert.equal(localStatus(id), 'active', 'la suppression doit pouvoir être retentée');
});

test('sans abonnement ni client Stripe : rien à résilier, aucun appel', async () => {
  const id = client();
  const r = await cancelSubscription(id);
  assert.equal(r.skipped, 'no_active_subscription');
  assert.deepEqual(calls, []);
});
