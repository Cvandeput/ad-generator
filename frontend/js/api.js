// Couche d'accès API : un seul endroit pour fetch, gestion d'erreur et la
// redirection sur 401. Le DOM ne parle qu'à ce module (pas de fetch éparpillé).

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
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
    throw new ApiError('Connexion au serveur impossible', 0);
  }

  if (res.status === 401 && redirectOn401 && !onLoginPage()) {
    location.href = '/login.html';
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError((data && data.error) || `Erreur ${res.status}`, res.status, data);
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
  changePassword: (currentPassword, newPassword) => request('/api/auth/password', json({ currentPassword, newPassword })),
  acceptTerms: () => request('/api/auth/accept-terms', json({ acceptTerms: true })),
  verifyEmail: (token) => request('/api/auth/verify-email', json({ token }), { redirectOn401: false }),
  resendVerification: (email) => request('/api/auth/resend-verification', json(email ? { email } : {}), { redirectOn401: false }),

  // Facturation (prototype). `plans` est public ; 404 = BILLING_ENABLED=false.
  billing: {
    plans: () => request('/api/billing/plans', {}, { redirectOn401: false }),
    subscription: () => request('/api/billing/subscription', {}, { redirectOn401: false }),
    checkout: (plan) => request('/api/billing/checkout', json({ plan })),
    pack: () => request('/api/billing/pack', { method: 'POST' }),
    portal: () => request('/api/billing/portal', { method: 'POST' }),
    cancel: () => request('/api/billing/cancel', { method: 'POST' }),
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
