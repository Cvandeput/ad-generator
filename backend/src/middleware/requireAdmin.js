// 404 et non 403 : l'existence même de la console d'administration n'a pas à
// être confirmée à un compte qui n'y a pas droit.
import { isAdmin } from '../admin.js';

export default function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non authentifié' });
  if (!isAdmin(req.session.userId)) return res.status(404).json({ error: 'Introuvable' });
  return next();
}
