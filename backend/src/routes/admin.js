// Console d'administration. Monté derrière requireAdmin, qui répond 404 à tout
// le monde d'autre : l'URL ne révèle rien. Aucune route ne permet d'attribuer
// le rôle admin — cela se fait par ADMIN_EMAILS, côté serveur.
import { Router } from 'express';
import db from '../db.js';
import { config } from '../config.js';
import { destroyUserSessions } from '../sessions.js';
import { purgeUserFiles, purgeGenerationFiles } from '../storage.js';

const router = Router();

// --- Tableau de bord : volumétrie, coûts, échecs -----------------------------
router.get('/overview', (_req, res) => {
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  const gen = q(`SELECT COUNT(*) total,
                        SUM(status='done') done,
                        SUM(status='error') errors,
                        SUM(status='pending') pending,
                        ROUND(SUM(cost_usd), 3) cost_usd
                 FROM generations`);
  const today = q(`SELECT COUNT(*) n, ROUND(SUM(cost_usd), 3) cost_usd
                   FROM generations WHERE date(created_at) = date('now')`);
  const month = q(`SELECT COUNT(*) n, ROUND(SUM(cost_usd), 3) cost_usd
                   FROM generations WHERE created_at >= date('now','start of month')`);
  const users = q(`SELECT COUNT(*) total,
                          SUM(email_verified) verified,
                          SUM(role='admin') admins,
                          SUM(created_at >= date('now','-7 day')) new_week
                   FROM users`);
  const themes = db.prepare(`SELECT theme, COUNT(*) n FROM generations GROUP BY theme ORDER BY n DESC LIMIT 10`).all();
  const models = db.prepare(`SELECT COALESCE(model,'?') model, COUNT(*) n, ROUND(SUM(cost_usd),3) cost_usd
                             FROM generations WHERE status='done' GROUP BY model ORDER BY n DESC`).all();
  const fallback = q(`SELECT SUM(art_direction_source='fallback') fallback, SUM(art_direction_source='auto') auto
                      FROM generations WHERE status='done'`);
  res.json({ gen, today, month, users, themes, models, fallback, usdToEur: config.usdToEur });
});

// --- Comptes -----------------------------------------------------------------
router.get('/users', (req, res) => {
  const like = `%${String(req.query.q || '').slice(0, 80)}%`;
  const rows = db.prepare(`
    SELECT u.id, u.email, u.role, u.email_verified, u.created_at, u.last_login_at, u.locked_until,
           u.extra_credits,
           (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id AND g.status='done') AS done,
           (SELECT ROUND(SUM(cost_usd),3) FROM generations g WHERE g.user_id = u.id) AS cost_usd
    FROM users u
    WHERE u.email LIKE ?
    ORDER BY u.id DESC LIMIT 200
  `).all(like);
  // La formule vit dans la table subscriptions, absente si la facturation n'a
  // jamais été activée : on la lit à part, en tolérant son absence.
  let subs = new Map();
  try {
    subs = new Map(db.prepare('SELECT user_id, plan_key, status, period_end FROM subscriptions').all().map((s) => [s.user_id, s]));
  } catch { /* table absente */ }
  res.json({
    users: rows.map((u) => ({
      ...u,
      emailVerified: !!u.email_verified,
      subscription: subs.get(u.id) || null,
      unlimited: u.role === 'admin',
    })),
  });
});

// Crédits offerts (geste commercial, test, dédommagement d'un échec).
router.post('/users/:id/credits', (req, res) => {
  const n = Math.trunc(Number(req.body.credits));
  if (!Number.isFinite(n) || Math.abs(n) > 1000) return res.status(400).json({ error: 'Valeur hors bornes (-1000 à 1000)' });
  const user = db.prepare('SELECT id, extra_credits FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  const next = Math.max(0, (user.extra_credits || 0) + n);
  db.prepare('UPDATE users SET extra_credits = ? WHERE id = ?').run(next, user.id);
  audit('admin.credits', req, { target: user.id, delta: n, credits: next });
  res.json({ ok: true, credits: next });
});

// Déverrouiller un compte bloqué par les échecs de connexion.
router.post('/users/:id/unlock', (req, res) => {
  const info = db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Compte introuvable' });
  audit('admin.unlock', req, { target: Number(req.params.id) });
  res.json({ ok: true });
});

// Marquer une adresse comme vérifiée (support : l'e-mail n'arrive pas).
router.post('/users/:id/verify', (req, res) => {
  const info = db.prepare("UPDATE users SET email_verified = 1, email_verified_at = datetime('now') WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Compte introuvable' });
  audit('admin.verify', req, { target: Number(req.params.id) });
  res.json({ ok: true });
});

// Révoquer toutes les sessions d'un compte (compte compromis).
router.post('/users/:id/logout-all', (req, res) => {
  const n = destroyUserSessions(Number(req.params.id));
  audit('admin.logout_all', req, { target: Number(req.params.id), sessions: n });
  res.json({ ok: true, revoked: n });
});

// Suppression de compte — art. 17. Efface les lignes ET les fichiers : la
// cascade SQL ne touche pas le disque. Un admin ne peut pas se supprimer
// lui-même ni supprimer un autre admin (garde-fou contre la fausse manœuvre).
router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  if (user.role === 'admin') return res.status(400).json({ error: "Un compte administrateur ne peut pas être supprimé ici : retire l'adresse de ADMIN_EMAILS d'abord." });
  const purged = purgeUserFiles(id);
  destroyUserSessions(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit('admin.user_deleted', req, { target: id, email: user.email, ...purged });
  res.json({ ok: true, ...purged });
});

// --- Générations -------------------------------------------------------------
router.get('/generations', (req, res) => {
  const status = ['done', 'error', 'pending'].includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`
    SELECT g.id, g.user_id, u.email, g.brand, g.theme, g.status, g.error, g.model, g.image_size,
           g.cost_usd, g.art_direction_source, g.product_count, g.input_count, g.created_at
    FROM generations g LEFT JOIN users u ON u.id = g.user_id
    ${status ? 'WHERE g.status = ?' : ''}
    ORDER BY g.id DESC LIMIT 100
  `).all(...(status ? [status] : []));
  res.json({ generations: rows });
});

router.delete('/generations/:id', (req, res) => {
  const row = db.prepare('SELECT id, output_path FROM generations WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Introuvable' });
  const files = purgeGenerationFiles(row.id, row.output_path);
  db.prepare('DELETE FROM generations WHERE id = ?').run(row.id);
  audit('admin.generation_deleted', req, { target: row.id, files });
  res.json({ ok: true, files });
});

function audit(event, req, extra = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ip: req.ip, by: req.session?.userId, ...extra }));
}

export default router;
