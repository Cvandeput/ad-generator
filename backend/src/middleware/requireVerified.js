// Refuse les actions coûteuses (génération) tant que l'adresse e-mail n'est pas
// confirmée. C'est CE garde-fou qui empêche un robot de créer des comptes en
// série pour cumuler les générations offertes — le quota seul ne fait que
// borner le coût par compte.
//
// Un abonné payant n'est jamais bloqué ici : il a fourni une carte, le doute
// sur un robot n'a plus lieu d'être (et le faire échouer serait absurde).
import db from '../db.js';
import { config } from '../config.js';

export default function requireVerified(req, res, next) {
  if (!config.emailVerification || !req.session?.userId) return next();

  const user = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.email_verified) return next();

  // La table n'existe que si la facturation a été activée au moins une fois.
  let sub = null;
  try {
    sub = db.prepare('SELECT status FROM subscriptions WHERE user_id = ?').get(req.session.userId);
  } catch {
    sub = null;
  }
  if (sub && ['active', 'trialing', 'past_due'].includes(sub.status)) return next();

  return res.status(403).json({
    code: 'EMAIL_NOT_VERIFIED',
    error: `Un lien de confirmation a été envoyé à ${user.email}. Cliquez dessus pour activer vos générations offertes — pensez aux indésirables.`,
  });
}
