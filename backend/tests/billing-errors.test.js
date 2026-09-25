// Erreurs Stripe vues par le client : jamais le message brut (anglais,
// identifiants internes), jamais un 401 (le front renverrait vers /login).
//
//   node --test tests/billing-errors.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../src/middleware/errors.js';

function run(err) {
  const out = {};
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  const origError = console.error;
  console.error = () => {}; // l'erreur est journalisée côté serveur, pas ici
  try { errorHandler(err, { method: 'POST', originalUrl: '/api/billing/withdrawal' }, res, () => {}); } finally { console.error = origError; }
  return out;
}

// Même forme que les erreurs du SDK : `type` = nom de classe, `statusCode` = HTTP de Stripe.
const stripeError = (type, statusCode, message) => Object.assign(new Error(message), { type, statusCode });

test('clé Stripe révoquée : 503, pas 401', () => {
  const out = run(stripeError('StripeAuthenticationError', 401, 'Invalid API Key provided: sk_live_****abcd'));
  assert.equal(out.status, 503);
  assert.doesNotMatch(out.body.error, /sk_|Invalid API Key/);
});

test('requête refusée par Stripe : 502 et message générique en français', () => {
  const out = run(stripeError('StripeInvalidRequestError', 400, 'No such subscription: sub_1Abc'));
  assert.equal(out.status, 502);
  assert.doesNotMatch(out.body.error, /sub_|No such/);
  assert.match(out.body.error, /paiement/);
});

test('les erreurs applicatives 4xx gardent leur message', () => {
  const out = run(Object.assign(new Error('Formule inconnue'), { status: 400 }));
  assert.equal(out.status, 400);
  assert.equal(out.body.error, 'Formule inconnue');
});
