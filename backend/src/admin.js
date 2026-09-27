// Rôle administrateur. La source de vérité est la variable d'environnement
// ADMIN_EMAILS, pas la base : on ne peut pas se promouvoir par une requête, il
// faut un accès au serveur. La synchronisation au démarrage est stricte dans
// les deux sens — retirer une adresse de la variable retire le rôle.
import db from './db.js';
import { config } from './config.js';

export function syncAdmins() {
  const emails = config.adminEmails;
  const demoted = emails.length
    ? db.prepare(`UPDATE users SET role = 'user' WHERE role = 'admin' AND email NOT IN (${emails.map(() => '?').join(',')})`).run(...emails).changes
    : db.prepare("UPDATE users SET role = 'user' WHERE role = 'admin'").run().changes;
  let promoted = 0;
  for (const e of emails) {
    // deleted_at IS NULL : un compte supprimé ne doit jamais être re-promu.
    promoted += db.prepare("UPDATE users SET role = 'admin' WHERE email = ? AND role != 'admin' AND deleted_at IS NULL").run(e).changes;
  }
  if (promoted || demoted) console.log(`🛡️  Rôles administrateur : ${promoted} ajouté(s), ${demoted} retiré(s)`);
  const total = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND deleted_at IS NULL").get().n;
  const absent = emails.filter((e) => !db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted_at IS NULL').get(e));
  if (absent.length) console.warn(`⚠️  ADMIN_EMAILS : aucun compte pour ${absent.join(', ')} (le rôle sera posé à la création du compte).`);
  if (!total) console.warn('⚠️  Aucun compte administrateur. Renseigne ADMIN_EMAILS dans .env.');
  return total;
}

// Filtre critique : sans `deleted_at IS NULL`, une session survivante d'un
// ancien admin supprimé rouvrirait la console d'administration.
export const isAdmin = (userId) =>
  db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND deleted_at IS NULL").get(userId) !== undefined;

// Appelé à la création d'un compte : une adresse listée devient admin tout de
// suite, sans attendre un redémarrage.
export const roleFor = (email) => (config.adminEmails.includes(String(email).toLowerCase()) ? 'admin' : 'user');
