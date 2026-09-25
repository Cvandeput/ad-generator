// Migration additive + accès base pour la facturation. Aucune table existante
// n'est modifiée en dehors de colonnes ajoutées (ADD COLUMN), donc l'app
// fonctionne à l'identique avec BILLING_ENABLED=false.
import db from '../db.js';

function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export function migrate() {
  addColumn('users', 'stripe_customer_id', 'TEXT');
  addColumn('users', 'extra_credits', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id                INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      stripe_subscription_id TEXT UNIQUE,
      plan_key               TEXT NOT NULL DEFAULT 'free',
      status                 TEXT NOT NULL DEFAULT 'inactive',
      quota_month            INTEGER NOT NULL DEFAULT 0,
      period_start           TEXT,
      period_end             TEXT,
      cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
    -- Idempotence : Stripe rejoue un event tant qu'il n'a pas reçu de 2xx.
    CREATE TABLE IF NOT EXISTS stripe_events (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // --- Rétractation ---------------------------------------------------------
  // Date de CONCLUSION du contrat, distincte de `period_start`. C'est elle qui
  // ouvre les 14 jours. La distinction n'est pas cosmétique : `period_start`
  // avance à chaque reconduction mensuelle, et si les 14 jours en partaient,
  // chaque mois rouvrirait une fenêtre de rétractation. Or une reconduction
  // tacite n'est pas un nouveau contrat à distance : elle n'ouvre aucun droit
  // neuf. Même raisonnement pour un changement de formule en cours de période.
  addColumn('subscriptions', 'subscribed_at', 'TEXT');
  // Montant réellement encaissé sur la dernière facture payée, en CENTIMES.
  // Rembourser « le prix affiché de la formule » serait faux dès qu'un code
  // promo, une proratisation ou une TVA différente s'en mêle.
  addColumn('subscriptions', 'last_paid_cents', 'INTEGER');
  addColumn('subscriptions', 'last_payment_intent', 'TEXT');

  db.exec(`
    -- Journal des demandes de rétractation. Chaque ligne fige le calcul tel
    -- qu'il a été fait au moment de la demande : le quota, le prix ou la
    -- consommation peuvent bouger ensuite, l'euro remboursé doit rester
    -- justifiable des années plus tard.
    CREATE TABLE IF NOT EXISTS withdrawals (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind                   TEXT NOT NULL DEFAULT 'subscription', -- subscription | pack
      plan_key               TEXT,
      paid_cents             INTEGER NOT NULL DEFAULT 0,
      quota                  INTEGER NOT NULL DEFAULT 0,
      used                   INTEGER NOT NULL DEFAULT 0,
      billable               INTEGER NOT NULL DEFAULT 0, -- part réellement fournie, bornée au quota
      refund_cents           INTEGER NOT NULL DEFAULT 0,
      consent_at             TEXT,
      consent_version        TEXT,
      subscribed_at          TEXT,
      deadline               TEXT,
      -- pending → refunded | simulated | review | failed
      status                 TEXT NOT NULL DEFAULT 'pending',
      stripe_refund_id       TEXT,
      stripe_subscription_id TEXT,
      stripe_payment_intent  TEXT,
      error                  TEXT,
      ip                     TEXT,
      requested_at           TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, requested_at DESC);

    -- Achats de packs de crédits. Un pack est un contrat DISTINCT de
    -- l'abonnement (paiement unique), avec sa propre fenêtre de 14 jours :
    -- sans cette table, impossible de savoir quand il a été acheté ni combien
    -- il a coûté, donc impossible d'en calculer la rétractation.
    CREATE TABLE IF NOT EXISTS credit_purchases (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credits               INTEGER NOT NULL,
      paid_cents            INTEGER NOT NULL,
      stripe_session_id     TEXT UNIQUE,
      stripe_payment_intent TEXT,
      withdrawn_at          TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_credit_purchases_user ON credit_purchases(user_id, created_at DESC);
  `);
  // Pack visé par une rétractation. Sans ce lien, impossible de savoir qu'une
  // demande précédente sur LE MÊME pack a échoué ou déjà remboursé, donc de
  // bloquer un second remboursement automatique (cf. priorContractWithdrawal).
  addColumn('withdrawals', 'credit_purchase_id', 'INTEGER');
}

// `deleted_at IS NULL` partout : un compte désactivé n'a plus de quota, plus de
// client Stripe à retrouver, plus rien. L'oublier sur UNE de ces requêtes suffit
// à faire revivre le compte par une porte dérobée (le webhook, typiquement).
export const getUser = (id) =>
  db
    .prepare(
      `SELECT id, email, created_at, stripe_customer_id, extra_credits, free_quota_forfeited,
              withdrawal_consent_at, withdrawal_consent_version, deleted_at
       FROM users WHERE id = ? AND deleted_at IS NULL`
    )
    .get(id);
export const getUserByCustomer = (cus) =>
  db.prepare('SELECT id FROM users WHERE stripe_customer_id = ? AND deleted_at IS NULL').get(cus);
// Seul usage légitime d'un compte supprimé : le webhook doit le distinguer d'un
// compte INCONNU. Un paiement qui arrive pour un compte supprimé appelle une
// action (résilier, rembourser) ; un compte inconnu, seulement un signalement.
export const isDeletedUser = (id) =>
  !!db.prepare('SELECT 1 FROM users WHERE id = ? AND deleted_at IS NOT NULL').get(id);
export const getDeletedUserByCustomer = (cus) =>
  db.prepare('SELECT id FROM users WHERE stripe_customer_id = ? AND deleted_at IS NOT NULL').get(cus);
export const setCustomerId = (userId, cus) => db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ? AND deleted_at IS NULL').run(cus, userId);
export const getSubscription = (userId) => db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
// Créditer un compte supprimé n'a aucun sens et ferait réapparaître de la
// valeur sur une ligne pseudonymisée : le webhook Stripe est la porte la plus
// probable (un paiement arrive après la suppression).
export const addCredits = (userId, n) => db.prepare('UPDATE users SET extra_credits = extra_credits + ? WHERE id = ? AND deleted_at IS NULL').run(n, userId);
export const consumeCredit = (userId) => db.prepare('UPDATE users SET extra_credits = extra_credits - 1 WHERE id = ? AND extra_credits > 0 AND deleted_at IS NULL').run(userId);

export function upsertSubscription(row) {
  db.prepare(`
    INSERT INTO subscriptions (user_id, stripe_subscription_id, plan_key, status, quota_month, period_start, period_end, cancel_at_period_end, subscribed_at, updated_at)
    VALUES (@user_id, @stripe_subscription_id, @plan_key, @status, @quota_month, @period_start, @period_end, @cancel_at_period_end, COALESCE(@subscribed_at, @period_start, datetime('now')), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan_key = excluded.plan_key, status = excluded.status, quota_month = excluded.quota_month,
      period_start = excluded.period_start, period_end = excluded.period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      -- Même abonnement (même identifiant) : la date de conclusion ne bouge
      -- JAMAIS. Une reconduction mensuelle ou un changement de formule qui la
      -- réécrirait rouvrirait 14 jours de rétractation à chaque fois.
      -- Autre identifiant : c'est un NOUVEAU contrat (réabonnement après
      -- résiliation), qui ouvre son propre délai. Garder l'ancienne date le
      -- rendrait « hors délai » dès le jour de sa conclusion.
      subscribed_at = CASE
        WHEN subscriptions.stripe_subscription_id IS excluded.stripe_subscription_id
          THEN COALESCE(subscriptions.subscribed_at, excluded.subscribed_at)
        ELSE excluded.subscribed_at
      END,
      updated_at = datetime('now')
  `).run({ subscribed_at: null, ...row });
}

// Montant encaissé sur la dernière facture payée + son PaymentIntent : c'est
// la seule base honnête d'un remboursement partiel (le prix affiché ignore les
// codes promo et les proratisations de Stripe).
export const setLastPayment = (userId, cents, paymentIntent) =>
  db
    .prepare('UPDATE subscriptions SET last_paid_cents = ?, last_payment_intent = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(Number.isFinite(cents) ? Math.round(cents) : null, paymentIntent || null, userId);

// --- Rétractation : journal et achats de packs -------------------------------
export function insertWithdrawal(row) {
  const info = db
    .prepare(
      `INSERT INTO withdrawals
        (user_id, kind, plan_key, paid_cents, quota, used, billable, refund_cents,
         consent_at, consent_version, subscribed_at, deadline, status, ip, stripe_subscription_id, credit_purchase_id)
       VALUES
        (@user_id, @kind, @plan_key, @paid_cents, @quota, @used, @billable, @refund_cents,
         @consent_at, @consent_version, @subscribed_at, @deadline, @status, @ip, @stripe_subscription_id, @credit_purchase_id)`
    )
    .run({
      plan_key: null, consent_at: null, consent_version: null, subscribed_at: null, deadline: null, ip: null,
      stripe_subscription_id: null, credit_purchase_id: null, ...row,
    });
  return Number(info.lastInsertRowid);
}

// COALESCE sur l'identifiant de remboursement : c'est le seul champ qui
// représente de l'argent réellement sorti. Un `SET stripe_refund_id = NULL`
// effacerait la preuve d'un remboursement abouti dans le cas précis où l'étape
// SUIVANTE échoue (remboursement OK, résiliation en erreur) — on marquerait
// alors la demande `failed` en ayant perdu la trace du virement.
export const finishWithdrawal = (id, patch) =>
  db
    .prepare(
      `UPDATE withdrawals SET status = @status,
              stripe_refund_id = COALESCE(@stripe_refund_id, stripe_refund_id),
              stripe_payment_intent = COALESCE(@stripe_payment_intent, stripe_payment_intent),
              error = @error, processed_at = datetime('now')
       WHERE id = @id`
    )
    .run({ stripe_refund_id: null, stripe_payment_intent: null, error: null, ...patch, id });

// Écrit l'identifiant du remboursement DÈS qu'il existe, avant toute étape
// suivante susceptible d'échouer. L'argent est parti : la trace doit exister
// avant qu'autre chose puisse mal tourner.
export const attachRefund = (id, refundId, paymentIntent) =>
  db
    .prepare('UPDATE withdrawals SET stripe_refund_id = ?, stripe_payment_intent = ? WHERE id = ?')
    .run(refundId || null, paymentIntent || null, id);

export const getWithdrawal = (id) => db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);

// Dernière rétractation ABOUTIE (pas une demande en échec) sur une fenêtre
// glissante. Sert au garde-fou anti-abus, pas à refuser le droit : cf.
// docs/RETRACTATION.md §4.
// Une demande `failed` dont le remboursement est PARTI (stripe_refund_id posé,
// c'est l'étape suivante qui a échoué) compte aussi : l'argent est sorti.
// Filtré par `kind` : une rétractation de PACK ne doit pas pousser la
// rétractation d'ABONNEMENT en traitement manuel. Ce sont deux contrats
// distincts, et le comportement abusif que le garde-fou vise (souscrire,
// consommer, se rétracter, recommencer) est propre à l'abonnement.
export const lastWithdrawal = (userId, sinceIso, kind = 'subscription') =>
  db
    .prepare(
      `SELECT * FROM withdrawals
        WHERE user_id = ? AND kind = ? AND requested_at >= ?
          AND (status IN ('refunded','simulated','review') OR stripe_refund_id IS NOT NULL)
        ORDER BY requested_at DESC LIMIT 1`
    )
    .get(userId, kind, sinceIso);

// Au-delà, une demande `pending` n'est plus « en cours » : le traitement
// (un remboursement + une résiliation Stripe) prend quelques secondes. Sans
// cette borne, un crash au mauvais moment bloquerait le droit pour toujours
// (ALREADY_PENDING) ; avec elle, la demande suivante part en traitement manuel.
export const PENDING_STALE_AFTER = "datetime('now', '-15 minutes')";

// Demande précédente sur LE MÊME contrat qui interdit de relancer un
// remboursement automatique : un remboursement déjà parti (stripe_refund_id),
// une demande en échec (le remboursement a pu passer sans que la réponse
// n'arrive) ou déjà confiée à l'exploitant (`review`). Relancer ferait
// rembourser deux fois le même paiement. Le droit n'est pas refusé pour autant :
// la nouvelle demande part en traitement manuel.
// Contrat = l'abonnement Stripe (`stripe_subscription_id`) ou le pack
// (`credit_purchase_id`). `IS` et pas `=` : un identifiant nul reste comparable.
// Une demande `pending` PÉRIMÉE (serveur tué pendant l'appel Stripe) compte
// aussi : on ne sait pas si le remboursement est parti.
export function priorContractWithdrawal(userId, kind, contractId) {
  const col = kind === 'pack' ? 'credit_purchase_id' : 'stripe_subscription_id';
  return db
    .prepare(
      `SELECT id, status, stripe_refund_id FROM withdrawals
        WHERE user_id = ? AND kind = ? AND ${col} IS ?
          AND (stripe_refund_id IS NOT NULL OR status IN ('failed','review')
               OR (status = 'pending' AND requested_at <= ${PENDING_STALE_AFTER}))
        ORDER BY id DESC LIMIT 1`
    )
    .get(userId, kind, contractId ?? null);
}

export const listWithdrawals = (userId) =>
  db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY requested_at DESC').all(userId);

export function insertCreditPurchase(row) {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO credit_purchases (user_id, credits, paid_cents, stripe_session_id, stripe_payment_intent)
       VALUES (@user_id, @credits, @paid_cents, @stripe_session_id, @stripe_payment_intent)`
    )
    .run({ stripe_session_id: null, stripe_payment_intent: null, ...row });
  // `changes` et pas `lastInsertRowid` seul : sur un INSERT ignoré (session
  // déjà enregistrée), SQLite renvoie le rowid de l'insertion PRÉCÉDENTE.
  return info.changes ? Number(info.lastInsertRowid) : null;
}

// Achat de pack : trace ET crédits dans UNE transaction, et crédits
// conditionnés à l'insertion. Un event rejoué (ou un échec entre les deux
// écritures suivi d'un rejeu Stripe) retombe sur l'INSERT OR IGNORE de la
// session et ne crédite pas une seconde fois.
export const creditPack = db.transaction((row) => {
  const id = insertCreditPurchase(row);
  if (id) addCredits(row.user_id, row.credits);
  return id;
});

// Dernier pack acheté et non encore rétracté.
export const lastCreditPurchase = (userId) =>
  db
    .prepare('SELECT * FROM credit_purchases WHERE user_id = ? AND withdrawn_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(userId);

export const markPackWithdrawn = (id) =>
  db.prepare("UPDATE credit_purchases SET withdrawn_at = datetime('now') WHERE id = ?").run(id);

export const removeCredits = (userId, n) =>
  db.prepare('UPDATE users SET extra_credits = MAX(0, extra_credits - ?) WHERE id = ?').run(n, userId);

// Consentement exprès à l'exécution immédiate. Horodaté AVANT la redirection
// vers Stripe : si le paiement échoue, la trace est inutile mais inoffensive ;
// si on l'écrivait après, un abandon de panier laisserait un abonnement payé
// sans consentement, donc remboursable à 100 %.
export const setWithdrawalConsent = (userId, version, ip) =>
  db
    .prepare(
      `UPDATE users SET withdrawal_consent_at = datetime('now'), withdrawal_consent_version = ?, withdrawal_consent_ip = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(version, ip || null, userId);

// true = event jamais vu (à traiter), false = doublon.
export function claimEvent(id, type) {
  return db.prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)').run(id, type).changes === 1;
}
export const releaseEvent = (id) => db.prepare('DELETE FROM stripe_events WHERE id = ?').run(id);

// Générations consommées depuis le début de la période. `pending` compte :
// sinon N requêtes simultanées passent toutes le contrôle avant qu'une seule
// ne soit marquée `done`. Les échecs ne sont pas décomptés.
export function usedSince(userId, since) {
  return db.prepare(
    `SELECT COUNT(*) n FROM generations WHERE user_id = ? AND status IN ('done','pending') AND created_at >= ?`
  ).get(userId, since || '1970-01-01 00:00:00').n;
}

// Générations encore en cours (lecture seule). Un crédit de pack n'est débité
// qu'à la FIN d'une génération réussie : rembourser pendant qu'elle tourne
// rembourserait un crédit sur le point d'être consommé.
export const pendingGenerations = (userId, since) =>
  db.prepare(
    `SELECT COUNT(*) n FROM generations WHERE user_id = ? AND status = 'pending' AND created_at >= ?`
  ).get(userId, since || '1970-01-01 00:00:00').n;
