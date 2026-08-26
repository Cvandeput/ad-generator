// Bloque toute route qui exige une session authentifiée.
export default function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Non authentifié' });
}
