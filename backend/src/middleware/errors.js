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
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne' : err.message || 'Requête invalide' });
}
