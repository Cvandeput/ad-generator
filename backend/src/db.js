import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ contient la base SQLite + les images (entrées et sorties). Gitignoré.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const OUTPUTS_DIR = path.join(DATA_DIR, 'outputs');

for (const dir of [DATA_DIR, UPLOADS_DIR, OUTPUTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS generations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand        TEXT NOT NULL,
    category     TEXT NOT NULL,
    flavor       TEXT,
    theme        TEXT NOT NULL,
    prompt_used  TEXT,
    input_count  INTEGER NOT NULL DEFAULT 0,
    output_path  TEXT,
    mime_type    TEXT DEFAULT 'image/png',
    cost_usd     REAL NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'pending',
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id, created_at DESC);
`);

// Migration : ajoute une colonne si absente (bases créées avant l'ajout).
function ensureColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === col)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  return true; // colonne créée à l'instant
}
ensureColumn('generations', 'cost_usd', 'REAL NOT NULL DEFAULT 0');
ensureColumn('generations', 'description', 'TEXT');
ensureColumn('generations', 'art_direction', 'TEXT');
// Source de la scène finale : 'manual' | 'auto' | 'fallback'. Mesure le taux de
// repli du Directeur Artistique en production (fiabilité réelle du node texte).
ensureColumn('generations', 'art_direction_source', 'TEXT');
// Modèle/taille réellement utilisés (renvoyés par n8n) : le coût est calculé
// depuis ces valeurs, plus depuis une variable d'env qui dérive.
ensureColumn('generations', 'model', 'TEXT');
ensureColumn('generations', 'image_size', 'TEXT');
// Nombre de produits attendus (saisi par l'utilisateur, optionnel).
ensureColumn('generations', 'product_count', 'INTEGER');

// Acceptation des CGU / mentions légales (version + date) et suivi sécurité.
ensureColumn('users', 'terms_version', 'TEXT');
ensureColumn('users', 'terms_accepted_at', 'TEXT');
ensureColumn('users', 'password_changed_at', 'TEXT');
ensureColumn('users', 'last_login_at', 'TEXT');
ensureColumn('users', 'failed_logins', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'locked_until', 'TEXT');
// Vérification d'e-mail : tant qu'elle n'est pas faite, le compte existe mais
// n'a aucune génération offerte (anti-création de comptes en masse).
if (ensureColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0')) {
  // Les comptes qui existaient avant cette fonctionnalité sont considérés comme
  // vérifiés : on ne coupe pas l'accès à des utilisateurs déjà en place.
  const n = db.prepare("UPDATE users SET email_verified = 1").run().changes;
  if (n) console.log(`✉️  ${n} compte(s) existant(s) marqué(s) comme vérifiés (antériorité).`);
}
ensureColumn('users', 'email_verified_at', 'TEXT');
// Rôle : 'user' | 'admin'. Positionné depuis ADMIN_EMAILS au démarrage
// (backend/src/admin.js) — jamais modifiable par une requête HTTP.
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");

// --- Suppression de compte (art. 17) : désactivation + pseudonymisation ------
// On ne supprime PAS la ligne : les `generations` y sont rattachées par clé
// étrangère et servent de trace comptable. L'identité, elle, est effacée
// (adresse neutralisée, mot de passe écrasé) — cf. docs/SUPPRESSION-COMPTE.md.
// `deleted_at` non nul = compte désactivé : TOUTE lecture de `users` doit
// l'exclure, sinon un compte supprimé se reconnecte.
ensureColumn('users', 'deleted_at', 'TEXT');
ensureColumn('users', 'deletion_reason', 'TEXT');
// Empreinte HMAC-SHA256 de l'adresse d'origine. Conservée APRÈS suppression,
// sans l'adresse en clair : elle ne permet pas de retrouver qui c'était, mais
// elle permet de reconnaître une réinscription. Sans elle, l'adresse se libère
// et le même utilisateur recrée un compte pour rafler un nouveau quota gratuit
// — l'abus que config.js documente déjà pour l'inscription ouverte.
ensureColumn('users', 'email_hash', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash)');
// Quota gratuit déchu : posé à la réinscription d'une adresse déjà supprimée.
// Le compte fonctionne normalement, il n'a simplement plus de générations
// offertes (il peut s'abonner). Lu par billing/quota.js.
ensureColumn('users', 'free_quota_forfeited', 'INTEGER NOT NULL DEFAULT 0');
// Colonnes de facturation posées ICI aussi, et pas seulement par
// billing/store.js `migrate()` : celle-ci ne tourne qu'avec BILLING_ENABLED=true,
// or la suppression de compte (deletion.js) et la console d'administration les
// lisent et les écrivent toujours. Sans elles, une base qui n'a jamais eu la
// facturation activée ne peut supprimer aucun compte. `migrate()` reste
// idempotente : elle voit les colonnes et ne fait rien.
ensureColumn('users', 'stripe_customer_id', 'TEXT');
ensureColumn('users', 'extra_credits', 'INTEGER NOT NULL DEFAULT 0');

// --- Consentement à l'exécution immédiate (art. VI.53 / 14(3) CDE) -----------
// Sans cette trace, la rétractation donne droit au remboursement INTÉGRAL :
// le prorata n'est opposable que si le consommateur a expressément demandé que
// l'exécution commence pendant les 14 jours. On horodate, on garde la version
// du texte accepté et l'IP — c'est la pièce à produire en cas de litige.
ensureColumn('users', 'withdrawal_consent_at', 'TEXT');
ensureColumn('users', 'withdrawal_consent_version', 'TEXT');
ensureColumn('users', 'withdrawal_consent_ip', 'TEXT');

// Petit magasin clé/valeur pour les secrets dérivés qui doivent survivre à une
// rotation de SESSION_SECRET (le poivre des empreintes d'e-mail, notamment :
// s'il change, toutes les empreintes existantes deviennent incomparables).
db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Jetons à usage unique (vérification d'e-mail, réinitialisation de mot de
// passe plus tard). Seul le SHA-256 du jeton est stocké.
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);
`);

export default db;
