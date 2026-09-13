// Page de connexion. Le lien « Créer un compte » n'apparaît que si le backend
// autorise l'inscription (REGISTER_MODE=invite|open).
import { api, ApiError } from './api.js';

const form = document.getElementById('auth-form');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('error');
const hint = document.getElementById('register-hint');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  try {
    await api.login(form.email.value.trim(), form.password.value);
    window.location.href = '/app.html';
  } catch (err) {
    showError(err instanceof ApiError ? err.message : 'Erreur');
    submitBtn.disabled = false;
  }
});

// Déjà connecté → studio. (silent : pas de redirection parasite vers /login.)
api
  .me({ silent: true })
  .then(() => {
    window.location.href = '/app.html';
  })
  .catch(() => {});

api
  .config()
  .then((cfg) => {
    if (!hint || !cfg || cfg.registerMode === 'closed') return;
    hint.innerHTML = `
      <span class="material-symbols-outlined text-outline text-[18px]">person_add</span>
      <span class="font-body-sm text-body-sm text-on-surface-variant">Pas encore de compte ?
        <a href="/register.html" class="text-primary-container underline">Créer un compte</a>${cfg.registerMode === 'invite' ? " (code d'invitation requis)" : ''}.
      </span>`;
  })
  .catch(() => {});
