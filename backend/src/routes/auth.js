import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db.js';

const router = Router();

// Limite les tentatives sur les routes sensibles (brute force).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard' },
});

function publicUser(row) {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

// Pas d'inscription publique : comptes pré-créés au démarrage (voir seed.js).
router.post('/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Compare toujours (évite un timing oracle sur l'existence du compte).
  const ok = user
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv');

  if (!user || !ok) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  res.json({ user: publicUser(user) });
});

export default router;
