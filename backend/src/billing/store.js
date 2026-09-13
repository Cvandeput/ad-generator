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
}

export const getUser = (id) => db.prepare('SELECT id, email, created_at, stripe_customer_id, extra_credits FROM users WHERE id = ?').get(id);
export const getUserByCustomer = (cus) => db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(cus);
export const setCustomerId = (userId, cus) => db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(cus, userId);
export const getSubscription = (userId) => db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
export const addCredits = (userId, n) => db.prepare('UPDATE users SET extra_credits = extra_credits + ? WHERE id = ?').run(n, userId);
export const consumeCredit = (userId) => db.prepare('UPDATE users SET extra_credits = extra_credits - 1 WHERE id = ? AND extra_credits > 0').run(userId);

export function upsertSubscription(row) {
  db.prepare(`
    INSERT INTO subscriptions (user_id, stripe_subscription_id, plan_key, status, quota_month, period_start, period_end, cancel_at_period_end, updated_at)
    VALUES (@user_id, @stripe_subscription_id, @plan_key, @status, @quota_month, @period_start, @period_end, @cancel_at_period_end, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan_key = excluded.plan_key, status = excluded.status, quota_month = excluded.quota_month,
      period_start = excluded.period_start, period_end = excluded.period_end,
      cancel_at_period_end = excluded.cancel_at_period_end, updated_at = datetime('now')
  `).run(row);
}

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
