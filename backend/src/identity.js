// Empreinte d'adresse e-mail à sens unique.
//
// Pourquoi ce module existe : quand un compte est supprimé (art. 17), on
// neutralise l'adresse en base — sinon on prétend effacer tout en gardant
// l'identifiant le plus direct de la personne. Mais neutraliser l'adresse la
// LIBÈRE : le même utilisateur se réinscrit et récupère un quota gratuit neuf.
// C'est exactement l'abus que config.js documente pour REGISTER_MODE=open.
//
// L'empreinte résout les deux à la fois : on ne conserve plus l'adresse, mais
// on peut encore répondre à « cette adresse a-t-elle déjà eu un compte ? ».
//
// HMAC-SHA256 et pas SHA-256 nu : un SHA-256 d'e-mail se casse en quelques
// minutes avec une liste d'adresses courantes — l'espace des adresses est petit
// et prévisible. Le poivre rend le calcul impossible sans le secret serveur,
// ce qui est la différence entre « pseudonymisé » et « juste encodé ».
import crypto from 'node:crypto';
import db from './db.js';

const META_KEY = 'email_hash_pepper';

let pepper = null;

// Le poivre doit survivre à une rotation de SESSION_SECRET : s'il changeait,
// toutes les empreintes déjà écrites deviendraient incomparables et la
// détection de réinscription tomberait en silence. D'où la priorité :
//   1. EMAIL_HASH_PEPPER (.env) — recommandé, hors base ;
//   2. valeur persistée dans app_meta — filet automatique, moins solide
//      (une fuite de la base livre le poivre avec les empreintes).
export function emailPepper() {
  if (pepper) return pepper;
  const fromEnv = process.env.EMAIL_HASH_PEPPER || '';
  if (fromEnv.length >= 32) {
    pepper = fromEnv;
    return pepper;
  }
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEY);
  if (row) {
    pepper = row.value;
    return pepper;
  }
  pepper = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(META_KEY, pepper);
  // Jamais la valeur elle-même dans les journaux : ils sont copiés, agrégés et
  // conservés bien plus largement que la base. On dit où la relire.
  console.warn(
    `⚠️  EMAIL_HASH_PEPPER absent : poivre généré et stocké en base (table app_meta). Pour le sortir de la base, recopie CETTE valeur dans .env (EMAIL_HASH_PEPPER=…) — n'en génère pas une nouvelle, sinon les empreintes déjà écrites deviennent inutilisables :\n   sqlite3 "${db.name}" "SELECT value FROM app_meta WHERE key = '${META_KEY}';"`
  );
  return pepper;
}

// Normalisation avant empreinte : sans elle, « Jean.Dupont@Gmail.com » et
// « jean.dupont@gmail.com » donnent deux empreintes différentes et la détection
// de réinscription se contourne en changeant une majuscule.
// On s'arrête à la casse et aux espaces : retirer les points ou le « +tag »
// serait plus agressif, mais ces variantes sont des adresses DISTINCTES chez
// beaucoup de fournisseurs — on refuserait le quota gratuit à quelqu'un qui n'a
// jamais eu de compte.
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

// Domaine `.invalid` (RFC 2606) : réservé aux adresses neutres des comptes
// supprimés (`deleted+<id>@account.invalid`, cf. deletion.js). Il doit être
// refusé partout où une adresse entre : sans ça, quelqu'un s'inscrit avec
// `deleted+42@account.invalid` et la suppression du compte 42 échoue ensuite
// sur la contrainte UNIQUE — après la résiliation Stripe. Aucune adresse réelle
// n'est concernée : ce domaine ne reçoit jamais de courrier.
export const isReservedEmail = (email) => /\.invalid\.?$/.test(normalizeEmail(email).split('@').pop());

export function emailHash(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return crypto.createHmac('sha256', emailPepper()).update(normalized).digest('hex');
}

// Cette adresse a-t-elle déjà appartenu à un compte supprimé ? Sert à refuser
// le quota gratuit à la réinscription, jamais à refuser l'inscription
// elle-même : recréer un compte est un droit, cumuler les quotas offerts non.
export function wasDeleted(email) {
  const h = emailHash(email);
  if (!h) return false;
  return (
    db.prepare('SELECT 1 FROM users WHERE email_hash = ? AND deleted_at IS NOT NULL LIMIT 1').get(h) !== undefined
  );
}
