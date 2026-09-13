// Accès direct au store de sessions (connect-sqlite3 : table `sessions`,
// colonne `sess` = JSON). Permet la révocation côté serveur : « déconnexion de
// tous les appareils », changement de mot de passe, purge des sessions expirées.
import Database from 'better-sqlite3';
import path from 'node:path';
import { DATA_DIR } from './db.js';

export const SESSIONS_DB_PATH = path.join(DATA_DIR, 'sessions.db');

let sdb = null;
function sessionsDb() {
  if (!sdb) {
    sdb = new Database(SESSIONS_DB_PATH);
    sdb.exec('CREATE TABLE IF NOT EXISTS sessions (sid PRIMARY KEY, expired, sess)');
  }
  return sdb;
}

// Supprime toutes les sessions d'un utilisateur. Retourne le nombre révoqué.
export function destroyUserSessions(userId) {
  const info = sessionsDb()
    .prepare(`DELETE FROM sessions WHERE json_valid(sess) AND json_extract(sess, '$.userId') = ?`)
    .run(userId);
  return info.changes;
}

// Purge des sessions expirées (connect-sqlite3 le fait aussi, on double au
// démarrage pour ne pas laisser traîner des cookies révoqués).
export function purgeExpiredSessions() {
  return sessionsDb().prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now()).changes;
}
