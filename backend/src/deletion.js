// Suppression de compte : la mécanique, partagée par les deux chemins qui y
// mènent — l'utilisateur lui-même (routes/account.js) et la console
// d'administration (routes/admin.js).
//
// Elle est ici et pas dupliquée parce que les deux chemins doivent produire
// EXACTEMENT le même état. La console faisait auparavant un `DELETE FROM users`
// sec : la cascade SQL emportait alors toutes les lignes `generations`, donc la
// trace comptable que l'exploitant demande justement de conserver. Deux
// définitions de « supprimer » dans une même base, c'est une divergence qui ne
// se voit qu'au moment où on cherche une écriture qui n'existe plus.
//
// Justification champ par champ : docs/SUPPRESSION-COMPTE.md.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import db from './db.js';
import { destroyUserSessions } from './sessions.js';
import { listUserFiles, purgeFiles } from './storage.js';
import { emailHash } from './identity.js';

// Domaine réservé par la RFC 2606 : `.invalid` ne se résout jamais, donc
// l'adresse de remplacement ne peut ni recevoir d'e-mail ni appartenir à
// quelqu'un. Elle reste unique (contrainte UNIQUE sur `email`) grâce à l'id.
export const neutralEmail = (id) => `deleted+${id}@account.invalid`;

// Résiliation de l'abonnement Stripe.
//
// Sans elle, on continue à prélever un compte supprimé : plus d'accès, plus
// d'adresse pour prévenir, et un prélèvement mensuel qui tourne. C'est le pire
// état atteignable, et il est irréparable côté client puisqu'il n'a plus de
// compte pour se plaindre.
//
// Cette fonction PROPAGE ses erreurs volontairement : l'appelant doit s'arrêter
// avant de toucher à la base, pas « réessayer plus tard ».
//
// Elle ne dépend PAS de BILLING_ENABLED : un abonnement souscrit pendant que la
// facturation était active continue de prélever après qu'on l'a désactivée.
// Les deux imports sont sans effet de bord (c'est billing/routes.js qui lance
// `migrate()`, pas store.js ni stripe.js), et chaque lecture tolère l'absence
// des tables de facturation.

// Statuts Stripe d'un abonnement qui n'est pas terminé, donc qui peut encore
// prélever ou reprendre. `canceled` et `incomplete_expired` sont définitifs.
const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'];

// Résiliation d'UN abonnement chez Stripe. « N'existe pas » et « déjà
// résilié » comptent comme des succès : le but est qu'aucun prélèvement ne
// tourne, et c'est déjà le cas.
async function cancelAtStripe(s, subscriptionId) {
  try {
    await s.subscriptions.cancel(subscriptionId);
    return 'canceled';
  } catch (err) {
    if (err?.code === 'resource_missing') return 'missing';
    // Stripe refuse de résilier deux fois. On relit l'état réel plutôt que de
    // deviner d'après le libellé de l'erreur.
    const current = await s.subscriptions.retrieve(subscriptionId).catch(() => null);
    if (current && !LIVE_STATUSES.includes(current.status)) return 'already_canceled';
    throw err;
  }
}

export async function cancelSubscription(userId) {
  let store;
  let stripeMod;
  try {
    store = await import('./billing/store.js');
    stripeMod = await import('./billing/stripe.js');
  } catch {
    return { skipped: 'billing_module_absent' };
  }

  let local = null;
  try {
    local = store.getSubscription(userId) || null;
  } catch {
    local = null; // table absente : facturation jamais activée
  }
  const customer = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(userId)?.stripe_customer_id || null;
  const withStripe = stripeMod.hasStripeKey();
  const seen = new Set();
  const canceled = [];

  // Stripe fait foi, pas la copie locale : un webhook manqué suffit à ce qu'un
  // abonnement actif soit absent de la base (ou y figure comme résilié).
  if (withStripe && customer) {
    const s = await stripeMod.stripe();
    for await (const sub of s.subscriptions.list({ customer, status: 'all', limit: 100 })) {
      seen.add(sub.id);
      if (!LIVE_STATUSES.includes(sub.status)) continue;
      await cancelAtStripe(s, sub.id);
      canceled.push(sub.id);
    }
  }

  const localId = local?.stripe_subscription_id || '';
  const localLive = !!local && LIVE_STATUSES.includes(local.status);
  // Abonnement de démonstration (`demo_…`, cf. demoSubscribe) : il n'a jamais
  // existé chez Stripe, l'y chercher échouerait et bloquerait la suppression.
  // Sans clé Stripe, on simule, comme le reste de billing/routes.js.
  const localAtStripe = withStripe && localId && !localId.startsWith('demo_');
  if (localLive && localAtStripe && !seen.has(localId)) {
    await cancelAtStripe(await stripeMod.stripe(), localId);
    canceled.push(localId);
  }
  if (localLive) store.upsertSubscription({ ...local, status: 'canceled', cancel_at_period_end: 0 });

  if (!canceled.length && !localLive) return { skipped: 'no_active_subscription' };
  return { canceled: true, subscriptionIds: canceled, ...(localLive && !localAtStripe ? { demo: true } : {}) };
}

// Pseudonymisation de la ligne, PUIS effacement des fichiers.
//
// L'ordre compte : si le SQL échoue, le compte reste entier et l'utilisateur
// peut réessayer ; si les fichiers partaient d'abord, un échec du SQL laisserait
// un compte intact dont les images ont disparu. Les chemins sont donc relevés
// DANS la transaction (juste avant qu'elle mette `output_path` à NULL) et les
// fichiers effacés après le commit. Tout est synchrone : aucune génération ne
// peut s'intercaler entre le relevé et la mise à jour.
//
// Tout le SQL est dans UNE transaction : un effacement à moitié fait (adresse
// neutralisée mais mot de passe intact, ou l'inverse) est pire que pas
// d'effacement du tout.
export function pseudonymizeUser(user, { reason = null } = {}) {
  const fingerprint = emailHash(user.email);
  const now = new Date().toISOString();

  const files = db.transaction(() => {
    const rows = listUserFiles(user.id);
    db.prepare(
      `UPDATE users SET
         email = ?, password_hash = ?, email_hash = ?, deleted_at = ?, deletion_reason = ?,
         terms_version = NULL, terms_accepted_at = NULL, last_login_at = NULL,
         failed_logins = 0, locked_until = NULL, withdrawal_consent_ip = NULL,
         extra_credits = 0, role = 'user'
       WHERE id = ?`
    ).run(
      neutralEmail(user.id),
      // Un bcrypt VALIDE d'une valeur aléatoire, pas une chaîne bidon : la
      // colonne est NOT NULL, et un hash malformé ferait échouer
      // bcrypt.compare() instantanément — ce qui rétablirait l'oracle temporel
      // que routes/auth.js prend soin de neutraliser.
      bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12),
      fingerprint,
      now,
      reason,
      user.id
    );

    // Les lignes `generations` RESTENT (trace comptable), rattachées à
    // l'identifiant désormais pseudonyme. On vide les champs de texte libre :
    // ils peuvent contenir ce que la personne a saisi, et aucune obligation
    // comptable ne porte sur un prompt. Marque, thème, coût et date restent —
    // c'est précisément ce qui fait la trace.
    db.prepare(
      `UPDATE generations SET prompt_used = NULL, description = NULL, art_direction = NULL, output_path = NULL
       WHERE user_id = ?`
    ).run(user.id);

    // Jetons de vérification / réinitialisation : sans objet, et ils
    // permettraient de réactiver une adresse qui n'existe plus.
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(user.id);
    return rows;
  })();

  const purged = purgeFiles(files);
  const sessions = destroyUserSessions(user.id);
  return { ...purged, sessions };
}
