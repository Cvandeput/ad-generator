// Nettoyage des lignes à l'encodage corrompu (caractère de remplacement U+FFFD «�»).
//
//   docker compose exec backend node tools/fix-encoding.js          # dry-run (défaut)
//   docker compose exec backend node tools/fix-encoding.js --yes    # suppression réelle
//
// Contexte : d'anciennes lignes ont été insérées avec des accents cassés (ex.
// "p�che" au lieu de "pêche"). La corruption a remplacé les octets d'origine
// par U+FFFD : l'accent est PERDU, on ne peut pas le reconstituer. Le pipeline
// actuel (multer → SQLite → res.json utf-8) écrit correctement l'UTF-8 ; ce script
// ne concerne donc que les lignes héritées.
//
// Comportement : supprime les générations dont un champ texte contient U+FFFD
// (+ leur image de sortie et leurs images d'entrée). Le dry-run n'écrit rien.

import fs from 'node:fs';
import path from 'node:path';
import db, { UPLOADS_DIR } from '../src/db.js';

const apply = process.argv.includes('--yes');
const mode = apply ? 'SUPPRESSION' : 'DRY-RUN';
const REPLACEMENT = '�';
const TEXT_COLS = ['brand', 'category', 'flavor', 'theme', 'prompt_used', 'error'];

const rows = db.prepare('SELECT * FROM generations').all();
const corrupted = rows.filter((r) => TEXT_COLS.some((c) => typeof r[c] === 'string' && r[c].includes(REPLACEMENT)));

console.log(`[${mode}] nettoyage des lignes à l'encodage corrompu (U+FFFD)`);
console.log(`  lignes corrompues : ${corrupted.length}`);
for (const r of corrupted) {
  const bad = TEXT_COLS.filter((c) => typeof r[c] === 'string' && r[c].includes(REPLACEMENT))
    .map((c) => `${c}="${r[c]}"`)
    .join(', ');
  console.log(`    - #${r.id} (${r.status}) : ${bad}`);
}

if (corrupted.length === 0) {
  console.log('\nRien à nettoyer.');
  process.exit(0);
}
if (!apply) {
  console.log('\nDry-run : rien supprimé. Relancer avec --yes pour appliquer.');
  console.log('Note : l\'accent d\'origine est irrécupérable ; les lignes sont supprimées, pas réparées.');
  process.exit(0);
}

let files = 0;
let dirs = 0;
const purge = db.transaction(() => {
  for (const row of corrupted) {
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
    db.prepare('DELETE FROM generations WHERE id = ?').run(row.id);
  }
});
purge();

console.log(`\nSupprimé : ${corrupted.length} ligne(s), ${files} fichier(s), ${dirs} dossier(s) d'entrées.`);
process.exit(0);
