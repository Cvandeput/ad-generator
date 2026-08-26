import bcrypt from 'bcryptjs';
import db from './db.js';

// Comptes pré-créés depuis la variable d'env SEED_USERS.
// Format : "email:motdepasse,email2:motdepasse2"  (pas de virgule dans un mot de passe)
// Source de vérité : au démarrage, crée le compte s'il manque, sinon met à jour
// le mot de passe pour coller à .env.
export function seedUsers() {
  const raw = process.env.SEED_USERS || '';
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    console.warn('⚠️  SEED_USERS vide — aucun compte. Personne ne pourra se connecter.');
    return;
  }
  for (const e of entries) {
    const idx = e.indexOf(':');
    if (idx < 0) continue;
    const email = e.slice(0, idx).trim().toLowerCase();
    const password = e.slice(idx + 1);
    if (!email || !password) continue;
    const hash = bcrypt.hashSync(password, 12);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hash, email);
    } else {
      db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
    }
    console.log(`👤 compte prêt : ${email}`);
  }
}
