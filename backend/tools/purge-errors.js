// Nettoyage des générations en échec.
//
//   docker compose exec backend node tools/purge-errors.js            # dry-run (défaut)
//   docker compose exec backend node tools/purge-errors.js --yes      # suppression réelle
//
// Supprime les lignes status='error' (+ leurs images d'entrée dans uploads/) et
// les fichiers orphelins de outputs/ (un fichier <id>.<ext> sans ligne qui survit).
// Le dry-run n'écrit rien : il liste ce qui serait supprimé.

import fs from 'node:fs';
import path from 'node:path';
import db, { OUTPUTS_DIR, UPLOADS_DIR } from '../src/db.js';

const apply = process.argv.includes('--yes');
const mode = apply ? 'SUPPRESSION' : 'DRY-RUN';

const errorRows = db.prepare(`SELECT id, output_path FROM generations WHERE status='error'`).all();

// ids qui survivent = tout sauf les 'error' qu'on s'apprête à supprimer.
const survivingIds = new Set(
  db.prepare(`SELECT id FROM generations WHERE status != 'error'`).all().map((r) => r.id)
);

// Fichiers orphelins de outputs/ : nommés <id>.<ext>, id absent des survivants.
const orphanFiles = [];
if (fs.existsSync(OUTPUTS_DIR)) {
  for (const name of fs.readdirSync(OUTPUTS_DIR)) {
    const id = Number(path.basename(name, path.extname(name)));
    if (Number.isInteger(id) && !survivingIds.has(id)) {
      orphanFiles.push(path.join(OUTPUTS_DIR, name));
    }
  }
}

console.log(`[${mode}] purge des générations en échec`);
console.log(`  lignes status='error'        : ${errorRows.length}`);
console.log(`  fichiers orphelins outputs/   : ${orphanFiles.length}`);
for (const f of orphanFiles) console.log(`    - ${f}`);

if (!apply) {
  console.log("\nDry-run : rien supprimé. Relancer avec --yes pour appliquer.");
  process.exit(0);
}

let files = 0;
let dirs = 0;

const purge = db.transaction(() => {
  for (const row of errorRows) {
    if (row.output_path) {
      try {
        fs.unlinkSync(row.output_path);
        files++;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    const up = path.join(UPLOADS_DIR, String(row.id));
    if (fs.existsSync(up)) {
      fs.rmSync(up, { recursive: true, force: true });
      dirs++;
    }
  }
  db.prepare(`DELETE FROM generations WHERE status='error'`).run();
});
purge();

for (const f of orphanFiles) {
  try {
    fs.unlinkSync(f);
    files++;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

console.log(`\nSupprimé : ${errorRows.length} ligne(s), ${files} fichier(s), ${dirs} dossier(s) d'entrées.`);
process.exit(0);
