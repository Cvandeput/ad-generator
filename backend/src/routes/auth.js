import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { config } from '../config.js';
import { passwordIssues, MAX_PASSWORD } from '../password.js';
import requireAuth from '../middleware/requireAuth.js';
import { destroyUserSessions } from '../sessions.js';
import { createToken, consumeToken } from '../tokens.js';
import { roleFor } from '../admin.js';
import { sendMail, verificationEmail } from '../mail.js';

const router = Router();

// Limites par IP (brute force distribué sur plusieurs comptes) ; le verrouillage
// par compte (ci-dessous) couvre le brute force ciblé sur un seul compte.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard' },
});
// Le renvoi de lien est le point sensible : il envoie un e-mail à une adresse
// choisie par l'appelant. Limite basse, par IP.
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes, réessayez dans une heure' },
});
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard' },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard' },
});

// Verrouillage progressif d'un compte après N échecs consécutifs.
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const MAX_EMAIL = 254;

// Hash factice (coût 12) pour égaliser le temps de réponse quand l'email est
// inconnu. Un hash bcrypt VALIDE : un hash malformé fait échouer compare()
// immédiatement, ce qui rétablit l'oracle temporel.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    role: row.role || 'user',
    isAdmin: row.role === 'admin',
    termsVersion: row.terms_version || null,
    termsOutdated: row.terms_version !== config.termsVersion,
    // Sans vérification activée, tout le monde est considéré comme vérifié.
    emailVerified: !config.emailVerification || !!row.email_verified,
  };
}

// Envoie (ou renvoie) le lien de confirmation. Jamais bloquant pour l'appelant :
// un SMTP en panne ne doit pas faire échouer une inscription déjà enregistrée.
async function sendVerification(user, req) {
  const token = createToken(user.id, 'verify_email', config.verificationTtlHours);
  const base = config.allowedOrigins[0] || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/verify.html?token=${encodeURIComponent(token)}`;
  const mail = verificationEmail(link, config.verificationTtlHours);
  const sent = await sendMail({ to: user.email, ...mail });
  audit('verify.sent', req, { userId: user.id, sent });
  return sent;
}

function audit(event, req, extra = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ip: req.ip, ...extra }));
}

// Ouvre une session : nouvel identifiant (anti-fixation) + horodatage absolu.
function openSession(req, user, cb) {
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.userId = user.id;
    req.session.loginAt = Date.now();
    req.session.save(cb);
  });
}

function parseCredentials(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  return { email, password };
}

// --- Inscription (selon REGISTER_MODE ; 404 si fermée) ---------------------
router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    if (config.registerMode === 'closed') return res.status(404).json({ error: 'Introuvable' });

    const { email, password } = parseCredentials(req.body);
    const invite = String(req.body.inviteCode || '');
    const acceptTerms = req.body.acceptTerms === true || req.body.acceptTerms === 'true';

    if (config.registerMode === 'invite') {
      const a = Buffer.from(invite);
      const b = Buffer.from(config.registerInviteCode);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        audit('register.invite_refused', req, { email });
        return res.status(403).json({ error: "Code d'invitation invalide" });
      }
    }
    if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email invalide' });
    const issues = passwordIssues(password, email);
    if (issues.length) return res.status(400).json({ error: 'Mot de passe refusé : ' + issues.join(' ; '), issues });
    if (!acceptTerms) return res.status(400).json({ error: 'Vous devez accepter les mentions légales et la politique de confidentialité' });

    // Réponse identique que l'email existe ou non : pas d'énumération de comptes.
    // (En mode invite, le détenteur du code est de confiance ; on reste neutre.)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      audit('register.duplicate', req, { email });
      return res.status(202).json({ ok: true, message: 'Si cette adresse est disponible, le compte a été créé. Connectez-vous.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    // email_verified = 0 : le compte existe mais n'a aucune génération offerte
    // tant que l'adresse n'est pas confirmée (anti-comptes en série).
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, terms_version, terms_accepted_at, password_changed_at, email_verified, email_verified_at, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      // roleFor : une adresse listée dans ADMIN_EMAILS est admin dès la
      // création, sans attendre un redémarrage du serveur.
      .run(email, hash, config.termsVersion, now, now, config.emailVerification ? 0 : 1, config.emailVerification ? null : now, roleFor(email));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    audit('register.ok', req, { userId: user.id, verification: config.emailVerification });

    if (config.emailVerification) await sendVerification(user, req);

    openSession(req, user, (err) => {
      if (err) return next(err);
      res.status(201).json({ user: publicUser(user), verificationRequired: config.emailVerification });
    });
  } catch (err) {
    next(err);
  }
});

// --- Connexion ------------------------------------------------------------
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = parseCredentials(req.body);
    if (!email || !password || password.length > MAX_PASSWORD || email.length > MAX_EMAIL) {
      return res.status(400).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
      audit('login.locked', req, { userId: user.id });
      // Même message que l'échec classique : pas d'indice sur l'état du compte.
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      if (user) {
        const failed = (user.failed_logins || 0) + 1;
        const lock = failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
        audit(lock ? 'login.lock_triggered' : 'login.fail', req, { userId: user.id, failed });
      } else {
        audit('login.fail', req, { email });
      }
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
      .run(new Date().toISOString(), user.id);
    audit('login.ok', req, { userId: user.id });

    openSession(req, user, (err) => {
      if (err) return next(err);
      res.json({ user: publicUser(user) });
    });
  } catch (err) {
    next(err);
  }
});

// --- Déconnexion (cette session) -------------------------------------------
router.post('/logout', (req, res) => {
  const cookieName = req.app.get('sessionCookieName');
  req.session.destroy(() => {
    res.clearCookie(cookieName, { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' });
    res.json({ ok: true });
  });
});

// --- Déconnexion de TOUS les appareils (révoque chaque session du compte) ---
router.post('/logout-all', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const cookieName = req.app.get('sessionCookieName');
  const n = destroyUserSessions(uid);
  audit('logout.all', req, { userId: uid, sessions: n });
  req.session.destroy(() => {
    res.clearCookie(cookieName, { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' });
    res.json({ ok: true, revoked: n });
  });
});

// --- Changement de mot de passe (mot de passe actuel requis) ----------------
router.post('/password', requireAuth, loginLimiter, async (req, res, next) => {
  try {
    const current = String(req.body.currentPassword || '');
    const fresh = String(req.body.newPassword || '');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !(await bcrypt.compare(current, user.password_hash))) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }
    const issues = passwordIssues(fresh, user.email);
    if (issues.length) return res.status(400).json({ error: 'Mot de passe refusé : ' + issues.join(' ; '), issues });
    if (await bcrypt.compare(fresh, user.password_hash)) {
      return res.status(400).json({ error: "Le nouveau mot de passe doit être différent de l'actuel" });
    }
    const hash = await bcrypt.hash(fresh, 12);
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hash, new Date().toISOString(), user.id);
    // Les autres sessions deviennent invalides ; celle-ci est ré-ouverte.
    destroyUserSessions(user.id);
    audit('password.changed', req, { userId: user.id });
    openSession(req, user, (err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  } catch (err) {
    next(err);
  }
});

// --- Acceptation (ou ré-acceptation) des mentions légales --------------------
router.post('/accept-terms', requireAuth, (req, res) => {
  const accept = req.body.acceptTerms === true || req.body.acceptTerms === 'true';
  if (!accept) return res.status(400).json({ error: 'Acceptation requise' });
  db.prepare('UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?')
    .run(config.termsVersion, new Date().toISOString(), req.session.userId);
  audit('terms.accepted', req, { userId: req.session.userId, version: config.termsVersion });
  res.json({ ok: true, termsVersion: config.termsVersion });
});

// --- Vérification d'e-mail ---------------------------------------------------
// Le lien est public (l'utilisateur peut l'ouvrir dans un autre navigateur que
// celui de l'inscription) : c'est le jeton qui authentifie l'action.
router.post('/verify-email', verifyLimiter, (req, res) => {
  const userId = consumeToken(String(req.body.token || ''), 'verify_email');
  if (!userId) {
    audit('verify.failed', req, {});
    return res.status(400).json({ error: 'Lien invalide ou expiré. Demandez-en un nouveau.', code: 'INVALID_TOKEN' });
  }
  db.prepare('UPDATE users SET email_verified = 1, email_verified_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
  audit('verify.ok', req, { userId });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.json({ ok: true, user: publicUser(user) });
});

// Renvoi du lien. Réponse toujours identique : ne révèle pas si l'adresse existe.
router.post('/resend-verification', resendLimiter, async (req, res, next) => {
  try {
    const neutral = { ok: true, message: "Si un compte non confirmé existe pour cette adresse, un nouveau lien vient d'être envoyé." };
    if (!config.emailVerification) return res.json({ ok: true, message: 'Vérification désactivée.' });

    // Soit l'utilisateur est connecté, soit il fournit son adresse.
    const email = req.session?.userId
      ? db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId)?.email
      : String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(202).json(neutral);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || user.email_verified) return res.status(202).json(neutral);

    await sendVerification(user, req);
    res.status(202).json(neutral);
  } catch (err) {
    next(err);
  }
});

// Configuration publique (le front adapte la page de connexion / inscription).
router.get('/config', (_req, res) => {
  res.json({ registerMode: config.registerMode, termsVersion: config.termsVersion, emailVerification: config.emailVerification });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return req.session.destroy(() => res.status(401).json({ error: 'Non authentifié' }));
  }
  res.json({ user: publicUser(user), registerMode: config.registerMode });
});

export default router;
