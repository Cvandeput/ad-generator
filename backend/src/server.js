import './env.js'; // doit rester le premier import (charge .env racine)
import { config } from './config.js';
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
import csrfOrigin from './middleware/csrf.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { purgeExpiredSessions } from './sessions.js';
import { purgeExpiredTokens } from './tokens.js';
import requireVerified from './middleware/requireVerified.js';
import { RETIRED, normalizeModel } from './pricing.js';

// Facturation (prototype) : entièrement optionnelle. BILLING_ENABLED=false (défaut)
// → aucun module chargé, aucune route montée, comportement identique à avant.
const BILLING = process.env.BILLING_ENABLED === 'true';
const billing = BILLING ? await import('./billing/routes.js') : null;
const billingQuota = BILLING ? await import('./billing/quota.js') : null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLiteStore = connectSqlite3(session);

const app = express();
const { port: PORT, isProd, cookieSecure } = config;

// Nom du cookie : préfixe __Host- en HTTPS (le navigateur exige alors Secure,
// Path=/ et interdit l'attribut Domain → le cookie ne peut pas être posé par un
// sous-domaine ou en clair). Sans TLS (dev), le préfixe serait rejeté : 'sid'.
const SESSION_COOKIE = cookieSecure ? '__Host-sid' : 'sid';
app.set('sessionCookieName', SESSION_COOKIE);

// Webhook Stripe : corps BRUT, donc AVANT express.json(), et sans vérification
// d'origine (Stripe n'envoie pas d'en-tête Origin, il signe le corps).
if (BILLING) app.post('/api/billing/webhook', ...billing.webhook);

app.disable('x-powered-by');
app.set('trust proxy', 1); // derrière nginx (127.0.0.1) : IP réelle + cookie secure

// CSP stricte : scripts et styles locaux uniquement, polices Google, images
// locales + blob: (aperçus d'upload). Aucun handler inline (cf. components.js).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        'style-src-attr': ["'unsafe-inline'"], // style="background:…" des tuiles de thème
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'blob:', 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use(
  session({
    name: SESSION_COOKIE,
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // prolonge à chaque requête ; la durée absolue est vérifiée dans requireAuth
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionIdleMs,
    },
  })
);

// Vérification d'origine sur toute mutation de l'API (défense en profondeur
// en plus de SameSite=Lax).
app.use('/api', csrfOrigin);

// Pas de cache navigateur/proxy sur les réponses API (données de session).
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

seedUsers(); // crée/maj les comptes pré-définis (SEED_USERS)
const purged = purgeExpiredSessions();
if (purged) console.log(`🧹 ${purged} session(s) expirée(s) purgée(s)`);
const purgedTokens = purgeExpiredTokens();
if (purgedTokens) console.log(`🧹 ${purgedTokens} jeton(s) expiré(s) purgé(s)`);
console.log(config.emailVerification
  ? `✉️  Vérification d'e-mail activée (SMTP ${config.smtp.host || 'ABSENT — liens journalisés'})`
  : "✉️  Vérification d'e-mail désactivée");

const retiredOn = RETIRED[normalizeModel(config.geminiModel)];
if (retiredOn) {
  console.warn(`⚠️  GEMINI_MODEL=${config.geminiModel} est retiré le ${retiredOn}. Passer à gemini-3.1-flash-image (n8n + .env).`);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Adresse non confirmée = pas de génération. Monté devant /api/generate, donc
// indépendant de la facturation (routes/generate.js n'est pas modifié).
app.use('/api/generate', requireVerified);

// Quota d'abonnement : middleware monté DEVANT les routes de génération
// (routes/generate.js n'est pas modifié). Refuse avant l'upload des photos.
if (BILLING) {
  app.use('/api/generate', billingQuota.requireQuota);
  app.use('/api/billing', billing.default);
  console.log(`💳 Facturation activée (mode ${billing.MODE})`);
}
app.use('/api/auth', authRoutes);
app.use('/api', generateRoutes);
app.use('/api', notFound);

// Front statique (dev : le backend sert les fichiers ; prod : nginx). Les
// fichiers d'outillage du dossier frontend ne sont jamais servis.
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
const BLOCKED_STATIC = /^\/(package(-lock)?\.json|tailwind\.config\.js|node_modules(\/|$)|_tmp_shots(\/|$)|css\/input\.css|\.[^/]*)/;
app.use((req, res, next) => (BLOCKED_STATIC.test(req.path) ? res.status(404).end() : next()));
app.use(express.static(FRONTEND_DIR, { dotfiles: 'deny', index: 'index.html' }));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Backend démarré sur http://localhost:${PORT} (${isProd ? 'prod' : 'dev'}, cookie ${SESSION_COOKIE}, inscription ${config.registerMode})`);
});
