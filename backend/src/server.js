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

// Le cookie `secure` exige HTTPS : navigateur ignore le cookie sinon → session
// perdue. En prod (derrière nginx TLS) : true. En dev HTTP, isProd=false → false.
// SESSION_COOKIE_SECURE permet de forcer le cas (ex: NODE_ENV=production sans TLS
// en local → mettre SESSION_COOKIE_SECURE=false pour garder la session).
const cookieSecure =
  process.env.SESSION_COOKIE_SECURE != null ? process.env.SESSION_COOKIE_SECURE === 'true' : isProd;

app.set('trust proxy', 1); // derrière nginx : cookies secure + rate-limit corrects

// CSP désactivée côté helmet : le front charge Google Fonts (CSS + woff2) depuis
// des domaines externes. Le CSS Tailwind est compilé et servi en local (plus de
// CDN). Les autres en-têtes de sécurité restent actifs (nginx en rajoute en prod).
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
      secure: cookieSecure, // HTTPS obligatoire quand true (voir cookieSecure ci-dessus)
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
