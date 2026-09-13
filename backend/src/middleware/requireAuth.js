// Bloque toute route qui exige une session authentifiée. Applique aussi la
// durée de vie ABSOLUE (le cookie glissant ne prolonge pas indéfiniment).
import { config } from '../config.js';

export default function requireAuth(req, res, next) {
  const s = req.session;
  if (!s || !s.userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  if (!s.loginAt || Date.now() - s.loginAt > config.sessionAbsoluteMs) {
    return s.destroy(() => res.status(401).json({ error: 'Session expirée, reconnectez-vous' }));
  }
  return next();
}
