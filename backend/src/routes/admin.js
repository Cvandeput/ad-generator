// Console d'administration. Monté derrière requireAdmin, qui répond 404 à tout
// le monde d'autre : l'URL ne révèle rien. Aucune route ne permet d'attribuer
// le rôle admin — cela se fait par ADMIN_EMAILS, côté serveur.
import { Router } from 'express';
import db from '../db.js';
import { config } from '../config.js';
import { destroyUserSessions } from '../sessions.js';
import { purgeGenerationFiles } from '../storage.js';
import { cancelSubscription, pseudonymizeUser } from '../deletion.js';

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
                   FROM users WHERE deleted_at IS NULL`);
  // Comptes désactivés comptés à part : ils ne sont plus des clients, mais
  // l'exploitant doit pouvoir constater qu'ils existent (trace comptable).
  const deleted = q(`SELECT COUNT(*) total FROM users WHERE deleted_at IS NOT NULL`);
  const themes = db.prepare(`SELECT theme, COUNT(*) n FROM generations GROUP BY theme ORDER BY n DESC LIMIT 10`).all();
  const models = db.prepare(`SELECT COALESCE(model,'?') model, COUNT(*) n, ROUND(SUM(cost_usd),3) cost_usd
                             FROM generations WHERE status='done' GROUP BY model ORDER BY n DESC`).all();
  const fallback = q(`SELECT SUM(art_direction_source='fallback') fallback, SUM(art_direction_source='auto') auto
                      FROM generations WHERE status='done'`);
  res.json({ gen, today, month, users, deleted, themes, models, fallback, usdToEur: config.usdToEur });
});

// --- Comptes -----------------------------------------------------------------
// ?deleted=1 : liste les comptes DÉSACTIVÉS au lieu des comptes actifs. Ils
// n'apparaissent jamais dans la liste normale (ce ne sont plus des clients),
// mais ils doivent rester consultables : c'est la contrepartie de la
// conservation comptable — garder une trace sans pouvoir la lire n'a pas de sens.
router.get('/users', (req, res) => {
  const like = `%${String(req.query.q || '').slice(0, 80)}%`;
  const onlyDeleted = String(req.query.deleted || '') === '1';
  const rows = db.prepare(`
    SELECT u.id, u.email, u.role, u.email_verified, u.created_at, u.last_login_at, u.locked_until,
           u.extra_credits, u.deleted_at, u.deletion_reason, u.free_quota_forfeited,
           (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id AND g.status='done') AS done,
           (SELECT ROUND(SUM(cost_usd),3) FROM generations g WHERE g.user_id = u.id) AS cost_usd
    FROM users u
    WHERE u.email LIKE ? AND u.deleted_at IS ${onlyDeleted ? 'NOT NULL' : 'NULL'}
    ORDER BY u.id DESC LIMIT 200
  `).all(like);
  // La formule vit dans la table subscriptions, absente si la facturation n'a
  // jamais été activée : on la lit à part, en tolérant son absence.
  let subs = new Map();
  try {
    subs = new Map(db.prepare('SELECT user_id, plan_key, status, period_end FROM subscriptions').all().map((s) => [s.user_id, s]));
  } catch { /* table absente */ }
  res.json({
    deleted: onlyDeleted,
    users: rows.map((u) => ({
      ...u,
      emailVerified: !!u.email_verified,
      subscription: subs.get(u.id) || null,
      unlimited: u.role === 'admin',
      deletedAt: u.deleted_at || null,
    })),
  });
});

// Crédits offerts (geste commercial, test, dédommagement d'un échec).
router.post('/users/:id/credits', (req, res) => {
  const n = Math.trunc(Number(req.body.credits));
  if (!Number.isFinite(n) || Math.abs(n) > 1000) return res.status(400).json({ error: 'Valeur hors bornes (-1000 à 1000)' });
  const user = db.prepare('SELECT id, extra_credits FROM users WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  const next = Math.max(0, (user.extra_credits || 0) + n);
  db.prepare('UPDATE users SET extra_credits = ? WHERE id = ?').run(next, user.id);
  audit('admin.credits', req, { target: user.id, delta: n, credits: next });
  res.json({ ok: true, credits: next });
});

// Déverrouiller un compte bloqué par les échecs de connexion.
router.post('/users/:id/unlock', (req, res) => {
  const info = db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ? AND deleted_at IS NULL").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Compte introuvable' });
  audit('admin.unlock', req, { target: Number(req.params.id) });
  res.json({ ok: true });
});

// Marquer une adresse comme vérifiée (support : l'e-mail n'arrive pas).
router.post('/users/:id/verify', (req, res) => {
  const info = db.prepare("UPDATE users SET email_verified = 1, email_verified_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(Number(req.params.id));
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

// Suppression de compte — art. 17. EXACTEMENT la même mécanique que la
// suppression demandée par l'utilisateur (src/deletion.js) : fichiers effacés du
// disque, ligne pseudonymisée, abonnement Stripe résilié.
//
// Avant, cette route faisait un `DELETE FROM users` sec. La cascade SQL
// emportait alors toutes les lignes `generations` — donc la trace comptable que
// l'exploitant demande justement de conserver. Deux définitions de « supprimer »
// dans une même base, c'est une divergence qui ne se voit qu'au moment où on
// cherche une écriture qui n'existe plus.
//
// Un admin ne peut pas supprimer un autre admin (garde-fou contre la fausse
// manœuvre, et syncAdmins() le recréerait de toute façon au redémarrage).
//
// Tout le corps est dans le try : sous Express 4, une exception levée dans un
// handler async (pseudonymizeUser, typiquement) devient une promesse rejetée
// que personne n'attrape — pas de réponse, et le process peut tomber.
router.delete('/users/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!user) return res.status(404).json({ error: 'Compte introuvable' });
    if (user.role === 'admin') return res.status(400).json({ error: "Un compte administrateur ne peut pas être supprimé ici : retire l'adresse de ADMIN_EMAILS d'abord." });

    // Stripe avant la base, comme côté utilisateur : supprimer un compte dont le
    // prélèvement tourne encore est le seul état vraiment irrattrapable.
    let billing;
    try {
      billing = await cancelSubscription(id);
    } catch (err) {
      audit('admin.user_delete_stripe_failed', req, { target: id, error: String(err?.message || err) });
      return next(err);
    }

    const purged = pseudonymizeUser(user, { reason: 'supprimé par un administrateur' });
    audit('admin.user_deleted', req, { target: id, ...purged, billing });
    res.json({ ok: true, ...purged, billing });
  } catch (err) {
    audit('admin.user_delete_failed', req, { target: id, error: String(err?.message || err) });
    next(err);
  }
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
