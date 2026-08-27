// Page d'inscription. Crée le compte puis ouvre la session (redirige vers le
// dashboard). Le backend valide aussi (email, longueur, unicité) — voir auth.js.
import { api, ApiError } from './api.js';

const form = document.getElementById('auth-form');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('error');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');

  const email = form.email.value.trim();
  const password = form.password.value;
  const password2 = form.password2.value;

  if (password.length < 8) return showError('Mot de passe : 8 caractères minimum.');
  if (password !== password2) return showError('Les mots de passe ne correspondent pas.');

  submitBtn.disabled = true;
  try {
    await api.register(email, password);
    window.location.href = '/app.html';
  } catch (err) {
    showError(err instanceof ApiError ? err.message : 'Erreur');
    submitBtn.disabled = false;
  }
});

// Déjà connecté → dashboard (ignore le 401 pour rester sur la page).
api
  .me()
  .then(() => {
    window.location.href = '/app.html';
  })
  .catch(() => {});
