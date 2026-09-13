// Anti-CSRF par vérification d'origine (OWASP « verifying origin with standard
// headers »). Complète SameSite=Lax : un navigateur envoie toujours Origin sur
// un POST/PUT/DELETE (même same-origin via fetch) ; un Origin étranger = refus.
// Sans Origin ni Referer (curl, clients non-navigateur), on laisse passer : le
// CSRF est une attaque *via navigateur*, et ces clients n'ont pas de cookie.
import { config } from '../config.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export default function csrfOrigin(req, res, next) {
  if (SAFE.has(req.method)) return next();

  const proto = req.get('x-forwarded-proto') || req.protocol;
  const self = `${proto}://${req.get('host')}`;
  const allowed = new Set([self, ...config.allowedOrigins]);

  const origin = req.get('origin');
  const referer = req.get('referer');
  const presented = origin ? originOf(origin) : referer ? originOf(referer) : null;

  if (presented === null) return next();
  if (allowed.has(presented)) return next();

  console.warn(`[csrf] refus ${req.method} ${req.originalUrl} origin=${presented} attendu=${[...allowed].join('|')}`);
  return res.status(403).json({ error: 'Origine de la requête refusée' });
}
