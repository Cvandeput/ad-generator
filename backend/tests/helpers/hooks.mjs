// Hook de résolution ESM : redirige `shared/prompt.mjs` vers la doublure
// SEULEMENT si le vrai fichier n'existe pas. Sur le dépôt complet, ce hook est
// transparent — les tests s'exécutent contre le vrai module.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const STUB = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt-stub.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context).catch((err) => {
    if (specifier.endsWith('shared/prompt.mjs')) return { url: STUB, shortCircuit: true, format: 'module' };
    throw err;
  });
  if (result?.url?.endsWith('shared/prompt.mjs') && !fs.existsSync(fileURLToPath(result.url))) {
    return { url: STUB, shortCircuit: true, format: 'module' };
  }
  return result;
}
