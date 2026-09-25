// VÉRIF 1 — calcul du prorata de rétractation (art. 14(3) directive 2011/83).
//
//   node --test tests/prorata.test.js      (ou : npm test)
//
// Ce fichier est le garde-fou du seul calcul du projet qui produit un virement
// réel. Chaque cas correspond à une situation qui s'est déjà vue ailleurs, pas
// à une combinatoire gratuite : quota nul (synchronisation Stripe en retard),
// dépassement par crédits achetés (ratio > 100 %), bornes du délai.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Base jetable : importer le module charge db.js, qui crée app.db à l'import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adcraft-prorata-'));
process.env.SESSION_SECRET = 'x'.repeat(48);
process.env.N8N_TOKEN = 'y'.repeat(32);

const { proratedRefundCents, deadlineFrom, calendarDaysLeft, WITHDRAWAL_DAYS } = await import('../src/billing/withdrawal.js');
const { planCents } = await import('../src/billing/plans.js');
const { default: db } = await import('../src/db.js');

// Fermer la base AVANT de supprimer le dossier : sous Windows, un fichier
// SQLite ouvert ne peut pas être effacé (EPERM).
after(() => {
  db.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true, maxRetries: 5 });
});

const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
const PRO = planCents('pro'); // 2490
const STARTER = planCents('starter'); // 990

test('0 consommé sur 100 → remboursement intégral', () => {
  const r = proratedRefundCents({ paidCents: PRO, used: 0, quota: 100 });
  assert.equal(r.refundCents, 2490, `attendu 24,90 €, obtenu ${eur(r.refundCents)}`);
  assert.equal(r.billable, 0);
  assert.equal(r.retainedCents, 0);
});

test('quota entièrement consommé (100/100) → 0 €', () => {
  const r = proratedRefundCents({ paidCents: PRO, used: 100, quota: 100 });
  assert.equal(r.refundCents, 0);
  assert.equal(r.billable, 100);
  assert.equal(r.retainedCents, PRO);
});

test("60/100 sur la formule Pro → 9,96 € (le cas de l'énoncé)", () => {
  const r = proratedRefundCents({ paidCents: PRO, used: 60, quota: 100 });
  assert.equal(r.refundCents, 996, `attendu 9,96 €, obtenu ${eur(r.refundCents)}`);
  assert.equal(r.retainedCents, 1494); // 14,94 € conservés = 60 % de 24,90 €
});

test('dépassement par crédits achetés (130/100) → 0 €, jamais négatif', () => {
  const r = proratedRefundCents({ paidCents: PRO, used: 130, quota: 100 });
  assert.equal(r.refundCents, 0);
  assert.equal(r.billable, 100, 'la part facturable est bornée au quota, pas à la consommation');
  assert.ok(r.refundCents >= 0);
});

test('quota = 0 → pas de division par zéro, remboursement intégral', () => {
  const r = proratedRefundCents({ paidCents: STARTER, used: 0, quota: 0 });
  assert.equal(r.refundCents, STARTER);
  assert.ok(Number.isInteger(r.refundCents));
  const r2 = proratedRefundCents({ paidCents: STARTER, used: 7, quota: 0 });
  assert.equal(r2.refundCents, STARTER, 'quota nul : rien de fourni au titre de l’abonnement');
  assert.ok(!Number.isNaN(r2.refundCents));
});

test('quota infini (compte administrateur) ou montant non fini → jamais NaN', () => {
  // Infinity / Infinity = NaN : le journal refusait l'INSERT (NOT NULL) et
  // l'exception faisait tomber le serveur.
  const r = proratedRefundCents({ paidCents: PRO, used: 12, quota: Infinity });
  assert.equal(r.refundCents, PRO);
  assert.ok(Number.isInteger(r.refundCents) && Number.isInteger(r.retainedCents));
  const z = proratedRefundCents({ paidCents: Infinity, used: 12, quota: 100 });
  assert.equal(z.refundCents, 0, 'un montant payé infini n’est pas un paiement');
});

test('sans consentement exprès : remboursement intégral quelle que soit la consommation', () => {
  const r = proratedRefundCents({ paidCents: PRO, used: 95, quota: 100, consented: false });
  assert.equal(r.refundCents, PRO, "sans la case cochée, le prorata de l'art. 14(3) n'est pas opposable");
});

test("l'arrondi va au consommateur, jamais au professionnel", () => {
  // 37/100 sur Pro : 2490 × 63 / 100 = 1568,7 centimes.
  const r = proratedRefundCents({ paidCents: PRO, used: 37, quota: 100 });
  assert.equal(r.refundCents, 1569, 'ceil et non round : 1568,7 → 1569');
  // Sur les 300 générations du plan Studio, l'écart se voit à chaque valeur.
  const s = proratedRefundCents({ paidCents: planCents('studio'), used: 7, quota: 300 });
  assert.equal(s.refundCents, Math.ceil((5900 * 293) / 300));
});

test('tous les montants sont des entiers de centimes', () => {
  for (let used = 0; used <= 30; used += 1) {
    const r = proratedRefundCents({ paidCents: STARTER, used, quota: 30 });
    assert.ok(Number.isInteger(r.refundCents), `used=${used} produit ${r.refundCents}`);
    assert.ok(Number.isInteger(r.retainedCents));
    assert.equal(r.refundCents + r.retainedCents, STARTER, 'remboursé + conservé = payé');
  }
});

// --- Bornes du délai ---------------------------------------------------------
const T0 = '2026-09-01 10:00:00';
const at = (iso) => new Date(iso).getTime();
const stillOpen = (nowIso) => deadlineFrom(T0).getTime() >= at(nowIso);

test('jour 1 : dans le délai', () => {
  assert.equal(stillOpen('2026-09-02T10:00:00Z'), true);
});

test('jour 14 : encore dans le délai (le délai expire à la FIN du 14e jour)', () => {
  assert.equal(stillOpen('2026-09-15T10:00:00Z'), true);
  assert.equal(stillOpen('2026-09-15T23:59:00Z'), true);
});

test('jour 15 : hors délai', () => {
  assert.equal(stillOpen('2026-09-16T00:00:01Z'), false);
  assert.equal(stillOpen('2026-09-16T10:00:00Z'), false);
});

test("l'échéance tombe 14 jours après la date passée, en fin de journée", () => {
  assert.equal(WITHDRAWAL_DAYS, 14);
  // Seule la mécanique de date est vérifiée ici. Que la date passée soit bien
  // celle de la CONCLUSION (figée à la reconduction, neuve au réabonnement) est
  // vérifié contre un vrai serveur : withdrawal.test.js et
  // billing-withdrawal-guards.test.js.
  const d = deadlineFrom('2026-09-01 10:00:00');
  assert.equal(d.toISOString(), '2026-09-15T23:59:59.999Z');
});

test('date SQLite sans fuseau interprétée en UTC', () => {
  // Sans le « Z » ajouté par parseDate, Node lirait l'heure locale et le
  // résultat varierait selon le fuseau du serveur.
  assert.equal(deadlineFrom('2026-01-01 00:00:00').toISOString().slice(0, 10), '2026-01-15');
});

// --- Jours restants affichés --------------------------------------------------
test('les jours restants sont des jours calendaires, jamais 15 sur un délai de 14', () => {
  const deadline = deadlineFrom(T0); // fin du 14e jour
  assert.equal(calendarDaysLeft(deadline, new Date('2026-09-01T10:00:00Z')), 14, 'jour de souscription');
  assert.equal(calendarDaysLeft(deadline, new Date('2026-09-01T23:59:00Z')), 14, 'même tard le jour 0');
  assert.equal(calendarDaysLeft(deadline, new Date('2026-09-14T08:00:00Z')), 1, 'avant-dernier jour');
  // Dernier jour : le droit court encore jusqu'à minuit, « 0 jour » mentirait.
  assert.equal(calendarDaysLeft(deadline, new Date('2026-09-15T08:00:00Z')), 1, 'dernier jour');
});
