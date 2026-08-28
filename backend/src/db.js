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
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}
ensureColumn('generations', 'cost_usd', 'REAL NOT NULL DEFAULT 0');
ensureColumn('generations', 'description', 'TEXT');
ensureColumn('generations', 'art_direction', 'TEXT');
// Source de la scène finale : 'manual' | 'auto' | 'fallback'. Mesure le taux de
// repli du Directeur Artistique en production (fiabilité réelle du node texte).
ensureColumn('generations', 'art_direction_source', 'TEXT');

export default db;
