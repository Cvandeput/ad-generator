// Suppression de compte demandée par l'utilisateur lui-même (RGPD art. 17).
//
// Le besoin : garder une trace de l'activité après la suppression. Garder le
// profil intact sous un drapeau n'est pas un effacement : c'est le même
// traitement avec une colonne en plus. Mais il existe un motif de conservation
// réel (art. 17(3)(b) : obligation comptable), qui couvre les données de
// FACTURATION — pas l'adresse e-mail, pas le mot de passe, pas les photos produit.
//
// La réponse technique est la pseudonymisation : on casse le lien entre la ligne
// et la personne, on garde la ligne. Détail et justification de chaque champ :
// docs/SUPPRESSION-COMPTE.md.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import requireAuth from '../middleware/requireAuth.js';
import { cancelSubscription, pseudonymizeUser } from '../deletion.js';
import { config } from '../config.js';

const router = Router();

const log = (event, req, extra = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ip: req.ip, ...extra }));

// Action irréversible protégée par mot de passe : même limite que la connexion,
// sinon la route devient un oracle pour tester des mots de passe volés.
const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard' },
});

const cleanReason = (v) =>
  String(v || '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || null;

// Ce que l'utilisateur voit AVANT de confirmer : effacé, conservé, et pourquoi.
// Servi par le serveur pour que la page de confirmation ne puisse pas mentir sur
// ce qui va réellement se passer.
router.get('/deletion-preview', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const gen = db
    .prepare("SELECT COUNT(*) n, SUM(status='done') done FROM generations WHERE user_id = ?")
    .get(userId);
  const user = db.prepare('SELECT role FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
  if (!user) return res.status(401).json({ error: 'Non authentifié' });
  res.json({
    generations: gen.n || 0,
    images: gen.done || 0,
    isAdmin: user.role === 'admin',
    accountingYears: 7,
  });
});

router.post('/delete', requireAuth, deleteLimiter, async (req, res, next) => {
  const userId = req.session.userId;
  try {
    const password = String(req.body?.password || '');
    const reason = cleanReason(req.body?.reason);

    const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
    if (!user) return req.session.destroy(() => res.status(401).json({ error: 'Non authentifié' }));

    // Un admin qui se supprime lui-même se retire l'accès à sa propre console,
    // et syncAdmins() le recréerait au prochain démarrage depuis ADMIN_EMAILS :
    // le compte reviendrait à moitié. On refuse, avec la marche à suivre.
    if (user.role === 'admin') {
      return res.status(409).json({
        code: 'ADMIN_ACCOUNT',
        error: "Retirez d'abord cette adresse de ADMIN_EMAILS côté serveur, puis recommencez.",
      });
    }

    // Ré-authentification : la session seule ne suffit pas pour une action
    // irréversible (poste laissé ouvert, session volée).
    if (!password || !(await bcrypt.compare(password, user.password_hash))) {
      log('account.delete_bad_password', req, { userId });
      return res.status(401).json({ code: 'BAD_PASSWORD', error: 'Mot de passe incorrect' });
    }

    // 1. Stripe AVANT la base : si la résiliation échoue, rien n'a bougé et
    //    l'utilisateur peut réessayer avec un compte encore fonctionnel.
    let billing;
    try {
      billing = await cancelSubscription(userId);
    } catch (err) {
      log('account.delete_stripe_failed', req, { userId, error: String(err?.message || err) });
      return res.status(503).json({
        code: 'SUBSCRIPTION_CANCEL_FAILED',
        error: "Votre abonnement n'a pas pu être résilié. Réessayez dans un instant — nous ne supprimons pas un compte dont le prélèvement tourne encore.",
      });
    }

    // 2 & 3. Pseudonymisation en transaction, puis fichiers du disque après le
    //        commit. Le détail de chaque champ est dans docs/SUPPRESSION-COMPTE.md §2.
    const purged = pseudonymizeUser(user, { reason });

    log('account.deleted', req, {
      userId: user.id,
      by: 'self',
      reason,
      files: purged.files,
      generations: purged.generations,
      sessions: purged.sessions,
      billing,
    });

    req.session.destroy(() => {
      res.clearCookie(req.app.get('sessionCookieName'), {
        path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax',
      });
      res.json({ ok: true, generations: purged.generations, files: purged.files, billing });
    });
  } catch (err) {
    log('account.delete_failed', req, { userId, error: String(err?.message || err) });
    next(err);
  }
});

export default router;
