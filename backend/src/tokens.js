// Jetons à usage unique (vérification d'e-mail, et plus tard réinitialisation
// de mot de passe). Le jeton en clair n'existe que dans l'e-mail : la base ne
// stocke que son SHA-256, donc une fuite de la base ne permet pas d'activer un
// compte ni de prendre la main dessus.
import crypto from 'node:crypto';
import db from './db.js';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createToken(userId, purpose, ttlHours) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  // Un seul jeton valide à la fois par usage : un renvoi invalide le précédent.
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  db.prepare('INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .run(hash(token), userId, purpose, expires);
  return token;
}

// Consomme le jeton (usage unique). Retourne userId, ou null si invalide/expiré.
export function consumeToken(token, purpose) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?').get(hash(token), purpose);
  if (!row) return null;
  db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(row.token_hash);
  if (new Date(row.expires_at.replace(' ', 'T') + 'Z') < new Date()) return null;
  return row.user_id;
}

export function purgeExpiredTokens() {
  return db.prepare("DELETE FROM auth_tokens WHERE expires_at < datetime('now')").run().changes;
}
