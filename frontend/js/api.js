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

const onLoginPage = () => location.pathname.endsWith('/login.html');

async function request(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // Réseau injoignable (offline, backend down).
    throw new ApiError('Connexion au serveur impossible', 0);
  }

  // 401 → session expirée/absente : retour login (sauf déjà dessus).
  if (res.status === 401) {
    if (!onLoginPage()) location.href = '/login.html';
    throw new ApiError('Non authentifié', 401);
  }

  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError((data && data.error) || `Erreur ${res.status}`, res.status, data);
  }
  return data;
}

export const api = {
  // Auth
  me: () => request('/api/auth/me'),
  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  register: (email, password) =>
    request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  // Générations. `signal` : AbortController pour l'annulation côté client.
  generate: (formData, { signal } = {}) =>
    request('/api/generate', { method: 'POST', body: formData, signal }),
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
