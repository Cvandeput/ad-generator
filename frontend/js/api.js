// Couche d'accès API : un seul endroit pour fetch, gestion d'erreur et la
// redirection sur 401. Le DOM ne parle qu'à ce module (pas de fetch éparpillé).
import { t, has, currentLang, DEFAULT_LANG } from './i18n.js';

// --- Messages d'erreur ------------------------------------------------------
// Le backend est francophone : ses messages (`data.error`) ne sont pas
// traduits et ne peuvent pas l'être depuis le front. Politique retenue :
//   · en français, on garde le message du serveur — plus précis que le nôtre ;
//   · dans les autres langues, on affiche notre message localisé, choisi par
//     `data.code` quand le serveur en fournit un, sinon par le code HTTP.
// Ajouter un nouveau code métier = ajouter une clé `errors.code.<CODE>`.
function localizedMessage(status, code, serverMessage) {
  if (currentLang() === DEFAULT_LANG && serverMessage) return serverMessage;
  if (code && has(`errors.code.${code}`)) return t(`errors.code.${code}`);
  if (has(`errors.status.${status}`)) return t(`errors.status.${status}`);
  if (status >= 500) return t('errors.status.500');
  return t('errors.generic');
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = (data && data.code) || null;
    this.serverMessage = (data && data.error) || null;
  }
}

const onLoginPage = () => /\/(login|register)\.html$/.test(location.pathname);

// { redirectOn401 } : false pour les pages publiques (accueil) qui veulent
// juste savoir si l'utilisateur est connecté, sans le renvoyer vers /login.
async function request(path, opts = {}, { redirectOn401 = true } = {}) {
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...opts });
  } catch {
    // Réseau injoignable (offline, backend down).
    throw new ApiError(t('errors.network'), 0);
  }

  if (res.status === 401 && redirectOn401 && !onLoginPage()) {
    location.href = '/login.html';
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(localizedMessage(res.status, data && data.code, data && data.error), res.status, data);
  }
  return data;
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  // Auth
  config: () => request('/api/auth/config', {}, { redirectOn401: false }),
  me: ({ silent = false } = {}) => request('/api/auth/me', {}, { redirectOn401: !silent }),
  login: (email, password) => request('/api/auth/login', json({ email, password })),
  register: (payload) => request('/api/auth/register', json(payload)),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => request('/api/auth/logout-all', { method: 'POST' }),
  // Pas de redirection : un mot de passe actuel erroné répond 401 et doit
  // s'afficher dans la page (account.js distingue la vraie session expirée).
  changePassword: (currentPassword, newPassword) =>
    request('/api/auth/password', json({ currentPassword, newPassword }), { redirectOn401: false }),
  acceptTerms: () => request('/api/auth/accept-terms', json({ acceptTerms: true })),
  verifyEmail: (token) => request('/api/auth/verify-email', json({ token }), { redirectOn401: false }),
  resendVerification: (email) => request('/api/auth/resend-verification', json(email ? { email } : {}), { redirectOn401: false }),

  // Facturation (prototype). `plans` est public ; 404 = BILLING_ENABLED=false.
  billing: {
    plans: () => request('/api/billing/plans', {}, { redirectOn401: false }),
    subscription: () => request('/api/billing/subscription', {}, { redirectOn401: false }),
    // `withdrawalConsent` est obligatoire : le serveur refuse l'achat sans lui
    // (sans consentement exprès, une rétractation donnerait droit au
    // remboursement intégral). Ce n'est pas une option d'appel.
    checkout: (plan, withdrawalConsent) => request('/api/billing/checkout', json({ plan, withdrawalConsent })),
    pack: (withdrawalConsent) => request('/api/billing/pack', json({ withdrawalConsent })),
    portal: () => request('/api/billing/portal', { method: 'POST' }),
    cancel: () => request('/api/billing/cancel', { method: 'POST' }),
    // Rétractation : lecture (éligibilité + montant exact) puis exécution.
    withdrawal: () => request('/api/billing/withdrawal', {}, { redirectOn401: false }),
    withdraw: (kind, expectedRefundCents) =>
      request('/api/billing/withdrawal', json({ kind, expectedRefundCents })),
  },

  // Compte : suppression par l'utilisateur lui-même (art. 17).
  account: {
    // Aperçu : un 401 ici est une vraie session expirée → redirection normale.
    deletionPreview: () => request('/api/account/deletion-preview'),
    // Pas de redirection automatique : un mauvais mot de passe répond 401
    // BAD_PASSWORD et doit s'afficher dans la page. L'appelant (tarifs.js)
    // renvoie lui-même vers /login pour un 401 sans ce code (session expirée).
    remove: (password, reason) => request('/api/account/delete', json({ password, reason }), { redirectOn401: false }),
  },

  // Administration. 404 pour un compte non admin : l'existence des routes
  // n'est pas observable depuis le navigateur.
  admin: {
    overview: () => request('/api/admin/overview'),
    // `deleted` : liste les comptes DÉSACTIVÉS au lieu des comptes actifs.
    users: (q, deleted) => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (deleted) p.set('deleted', '1');
      const qs = p.toString();
      return request(`/api/admin/users${qs ? `?${qs}` : ''}`);
    },
    generations: (status) => request(`/api/admin/generations${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    credits: (id, credits) => request(`/api/admin/users/${id}/credits`, json({ credits })),
    verifyUser: (id) => request(`/api/admin/users/${id}/verify`, { method: 'POST' }),
    unlock: (id) => request(`/api/admin/users/${id}/unlock`, { method: 'POST' }),
    logoutAll: (id) => request(`/api/admin/users/${id}/logout-all`, { method: 'POST' }),
    deleteUser: (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
    deleteGeneration: (id) => request(`/api/admin/generations/${id}`, { method: 'DELETE' }),
  },

  // Générations. `signal` : AbortController pour l'annulation côté client.
  generate: (formData, { signal } = {}) => request('/api/generate', { method: 'POST', body: formData, signal }),
  history: (status = 'done') => request(`/api/history?status=${encodeURIComponent(status)}`),
  usage: () => request('/api/usage'),
  remove: (id) => request(`/api/generation/${id}`, { method: 'DELETE' }),
  retry: (id) => request(`/api/generation/${id}/retry`, { method: 'POST' }),
};

// Garde d'authentification commune : renvoie l'utilisateur ou redirige vers login.
export async function requireUser() {
  const { user } = await api.me(); // 401 → redirige déjà
  return user;
}
