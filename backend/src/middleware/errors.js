// Gestion d'erreur unique : toujours du JSON, jamais la page HTML d'Express
// (qui fuit le nom du framework et, hors prod, la stack). Les erreurs multer
// (taille, nombre, champ inattendu) deviennent des 4xx propres.
import multer from 'multer';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Introuvable' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: [413, 'Image trop lourde (10 Mo max par fichier)'],
      LIMIT_FILE_COUNT: [400, 'Trop de fichiers (14 max)'],
      LIMIT_UNEXPECTED_FILE: [400, 'Champ de fichier inattendu'],
      LIMIT_PART_COUNT: [400, 'Formulaire invalide'],
      LIMIT_FIELD_VALUE: [400, 'Champ trop long'],
    };
    const [status, message] = map[err.code] || [400, 'Envoi de fichier invalide'];
    return res.status(status).json({ error: message });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Corps de requête trop volumineux' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide' });
  }
  // Erreurs du SDK Stripe (`type` = nom de classe : StripeInvalidRequestError,
  // StripeAuthenticationError…). Leur message est en anglais et cite des
  // identifiants internes (client, abonnement, clé) : il reste dans les logs.
  // Leur `statusCode` est celui de STRIPE, pas celui du client : relayé tel
  // quel, une clé révoquée (401) renvoyait le navigateur vers /login. C'est une
  // panne d'un service amont : 503 si Stripe est injoignable ou refuse nos
  // identifiants, 502 sinon.
  if (typeof err.type === 'string' && err.type.startsWith('Stripe')) {
    console.error('[stripe]', req.method, req.originalUrl, err.type, err.statusCode || '', err.requestId || '', err.message);
    const unavailable = ['StripeAuthenticationError', 'StripePermissionError', 'StripeRateLimitError', 'StripeConnectionError', 'StripeAPIError'];
    return res.status(unavailable.includes(err.type) ? 503 : 502).json({
      error: 'Le service de paiement n’a pas pu traiter la demande. Réessayez plus tard.',
    });
  }
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message || 'Requête invalide' });
}
