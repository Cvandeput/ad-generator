// Suppression des fichiers d'une génération ou d'un compte. Isolé ici parce que
// trois appelants en ont besoin (suppression d'une génération, suppression de
// compte RGPD, purge de rétention) et qu'oublier le dossier d'entrée est
// exactement le bug qu'on corrige : les photos déposées restaient sur le disque
// après une suppression demandée par l'utilisateur.
import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';
import { UPLOADS_DIR } from './db.js';

// Efface le visuel produit ET le dossier des photos d'entrée.
export function purgeGenerationFiles(genId, outputPath) {
  let files = 0;
  if (outputPath) {
    try { fs.unlinkSync(outputPath); files += 1; } catch { /* déjà absent */ }
  }
  const inputDir = path.join(UPLOADS_DIR, String(genId));
  try {
    files += fs.readdirSync(inputDir).length;
    fs.rmSync(inputDir, { recursive: true, force: true });
  } catch { /* jamais créé */ }
  return files;
}

// Tous les fichiers d'un compte (suppression de compte, art. 17).
export function purgeUserFiles(userId) {
  const rows = db.prepare('SELECT id, output_path FROM generations WHERE user_id = ?').all(userId);
  let files = 0;
  for (const r of rows) files += purgeGenerationFiles(r.id, r.output_path);
  return { generations: rows.length, files };
}
