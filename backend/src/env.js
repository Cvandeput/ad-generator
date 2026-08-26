// Charge le .env de la racine du repo AVANT tout autre module (import en premier).
// Nécessaire car le backend peut être lancé depuis n'importe quel cwd.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
