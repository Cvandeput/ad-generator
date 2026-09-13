import bcrypt from 'bcryptjs';
import db from './db.js';

// Comptes pré-créés depuis la variable d'env SEED_USERS.
// Format : "email:motdepasse,email2:$2a$12$hashBcrypt"  (pas de virgule dans un mot de passe)
//   - la valeur peut être un hash bcrypt ($2a$/$2b$) : recommandé, pour ne pas
//     laisser de mot de passe en clair dans .env :
//       node -e "console.log(require('bcryptjs').hashSync('MonMotDePasse', 12))"
//   - un compte existant n'est PAS écrasé (il a pu changer son mot de passe via
//     /api/auth/password). Pour forcer : SEED_FORCE_PASSWORD=true (une fois).
export function seedUsers() {
  const raw = process.env.SEED_USERS || '';
  const force = process.env.SEED_FORCE_PASSWORD === 'true';
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    console.warn('⚠️  SEED_USERS vide — aucun compte pré-créé.');
    return;
  }
  for (const e of entries) {
    const idx = e.indexOf(':');
    if (idx < 0) continue;
    const email = e.slice(0, idx).trim().toLowerCase();
    let secret = e.slice(idx + 1);
    if (!email || !secret) continue;
    // Forme "b64:<base64 du hash>" : évite les `$` du hash bcrypt, que docker
    // compose (env_file) interpole comme des variables et corrompt.
    if (secret.startsWith('b64:')) secret = Buffer.from(secret.slice(4), 'base64').toString('utf8');
    const isHash = /^\$2[aby]\$\d\d\$/.test(secret);
    if (!isHash && secret.length < 12) {
      console.warn(`⚠️  ${email} : mot de passe seed < 12 caractères, compte ignoré.`);
      continue;
    }
    const hash = isHash ? secret : bcrypt.hashSync(secret, 12);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      if (force) {
        db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE email = ?')
          .run(hash, new Date().toISOString(), email);
        console.log(`👤 mot de passe forcé : ${email}`);
      }
    } else {
      // Compte administrateur créé à la main : e-mail considéré comme vérifié.
      db.prepare('INSERT INTO users (email, password_hash, password_changed_at, email_verified, email_verified_at) VALUES (?, ?, ?, 1, ?)')
        .run(email, hash, new Date().toISOString(), new Date().toISOString());
      console.log(`👤 compte créé : ${email}`);
    }
    if (!isHash) console.warn(`⚠️  ${email} : mot de passe en clair dans .env — remplace-le par son hash bcrypt.`);
  }
}
