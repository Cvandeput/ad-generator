import './env.js'; // doit rester le premier import (charge .env racine)
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connectSqlite3 from 'connect-sqlite3';

import { DATA_DIR } from './db.js';
import authRoutes from './routes/auth.js';
import generateRoutes from './routes/generate.js';
import { seedUsers } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLiteStore = connectSqlite3(session);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1); // derrière nginx : cookies secure + rate-limit corrects

// CSP désactivée côté helmet : le front utilise Tailwind CDN + Google Fonts.
// Les autres en-têtes de sécurité restent actifs (et nginx en rajoute en prod).
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'sid',
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd, // HTTPS obligatoire en prod
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

seedUsers(); // crée/maj les comptes pré-définis (SEED_USERS)

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', generateRoutes);

// Front statique. En prod, nginx sert ces fichiers directement ; ce fallback
// permet de lancer le backend seul en dev.
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));

app.listen(PORT, () => {
  console.log(`Backend démarré sur http://localhost:${PORT} (${isProd ? 'prod' : 'dev'})`);
});
