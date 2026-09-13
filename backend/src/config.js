// Configuration centralisée + validation au démarrage. Un secret par défaut en
// production est une faute, pas un avertissement : on refuse de démarrer.
import './env.js';
import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';

const PLACEHOLDER_SECRETS = new Set([
  '',
  'change-me-long-random-string',
  'change-me-shared-token',
  'dev-secret-change-me',
  'super-secret-jwt',
]);

function requireSecret(name, { minLength = 32 } = {}) {
  const v = process.env[name] || '';
  if (PLACEHOLDER_SECRETS.has(v) || v.length < minLength) {
    if (isProd) {
      console.error(`✖ ${name} absent, trop court (<${minLength}) ou valeur d'exemple. Génère : openssl rand -hex 48`);
      process.exit(1);
    }
    // Dev : secret éphémère (sessions perdues au redémarrage — voulu).
    const tmp = crypto.randomBytes(48).toString('hex');
    console.warn(`⚠️  ${name} non défini : valeur aléatoire éphémère utilisée (dev uniquement).`);
    return tmp;
  }
  return v;
}

// Mode d'inscription :
//   open    → inscription publique (défaut) : chaque compte démarre sur la formule
//             gratuite, dont le quota borne ce qu'un compte peut coûter.
//   invite  → inscription possible avec REGISTER_INVITE_CODE
//   closed  → /api/auth/register renvoie 404 (comptes = SEED_USERS uniquement)
// ⚠ En `open`, un robot peut créer N comptes pour cumuler N quotas gratuits.
// Garde-fous en place : 5 inscriptions/h par IP et quota gratuit faible
// (FREE_PLAN_QUOTA). Prochaine étape : vérification d'e-mail avant d'accorder
// le quota gratuit.
const REGISTER_MODE = (process.env.REGISTER_MODE || 'open').toLowerCase();
if (!['closed', 'invite', 'open'].includes(REGISTER_MODE)) {
  console.error(`✖ REGISTER_MODE invalide : ${REGISTER_MODE} (closed|invite|open)`);
  process.exit(1);
}
if (REGISTER_MODE === 'invite' && (process.env.REGISTER_INVITE_CODE || '').length < 12) {
  console.error('✖ REGISTER_MODE=invite exige REGISTER_INVITE_CODE (12 caractères minimum).');
  process.exit(1);
}

// Vérification d'e-mail. Par défaut : activée si un SMTP est configuré.
// EMAIL_VERIFICATION=true|false force le comportement.
const SMTP_HOST = process.env.SMTP_HOST || '';
const EMAIL_VERIFICATION =
  process.env.EMAIL_VERIFICATION != null ? process.env.EMAIL_VERIFICATION === 'true' : Boolean(SMTP_HOST);
if (EMAIL_VERIFICATION && !SMTP_HOST && isProd) {
  console.error('✖ EMAIL_VERIFICATION=true exige SMTP_HOST, sinon personne ne peut valider son compte.');
  process.exit(1);
}
if (!EMAIL_VERIFICATION && REGISTER_MODE === 'open') {
  console.warn("⚠️  Inscription ouverte SANS vérification d'e-mail : un robot peut créer des comptes en série pour cumuler les quotas gratuits. Configure SMTP_HOST, ou passe FREE_PLAN_QUOTA=0.");
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  sessionSecret: requireSecret('SESSION_SECRET'),
  n8nToken: requireSecret('N8N_TOKEN', { minLength: 24 }),
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || '',
  n8nTimeoutMs: Number(process.env.N8N_TIMEOUT_MS || 120000),

  // Origine publique du site (https://ads.devwork.cloud). Sert à la vérification
  // CSRF (Origin/Referer). Plusieurs valeurs séparées par des virgules.
  allowedOrigins: (process.env.APP_ORIGINS || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : ''))
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),

  cookieSecure:
    process.env.SESSION_COOKIE_SECURE != null ? process.env.SESSION_COOKIE_SECURE === 'true' : isProd,
  // Inactivité max (cookie glissant) et durée absolue d'une session.
  sessionIdleMs: Number(process.env.SESSION_IDLE_HOURS || 24) * 3600 * 1000,
  sessionAbsoluteMs: Number(process.env.SESSION_ABSOLUTE_DAYS || 7) * 24 * 3600 * 1000,

  registerMode: REGISTER_MODE,
  emailVerification: EMAIL_VERIFICATION,
  verificationTtlHours: Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 24),
  smtp: {
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 25),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || `AdCraft <noreply@${process.env.DOMAIN || 'localhost'}>`,
    // Postfix local avec certificat auto-signé : mettre false.
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
  },
  registerInviteCode: process.env.REGISTER_INVITE_CODE || '',
  // Version des CGU/mentions légales : incrémenter force une ré-acceptation.
  termsVersion: process.env.TERMS_VERSION || '2026-09-13',

  // Modèle image utilisé par n8n (le backend le lit pour le coût affiché AVANT
  // génération ; après génération, n8n renvoie le modèle réellement utilisé).
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.1-flash-image',
  geminiImageSize: process.env.GEMINI_IMAGE_SIZE || '',
  costOverrideUsd: process.env.COST_PER_IMAGE_USD ? Number(process.env.COST_PER_IMAGE_USD) : null,
  usdToEur: Number(process.env.USD_TO_EUR || 0.92),

  // Quotas de génération (par compte, pas par IP : c'est le compte qui coûte).
  genPerHour: Number(process.env.GEN_PER_HOUR || 20),
  genPerDay: Number(process.env.GEN_PER_DAY || 60),
};
