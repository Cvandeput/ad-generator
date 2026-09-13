// Inscription : contrôle en direct des critères (miroir de backend/src/password.js —
// le serveur reste l'autorité), code d'invitation selon REGISTER_MODE, CGU.
import { api, ApiError } from './api.js';

const form = document.getElementById('register-form');
const modeHint = document.getElementById('mode-hint');
const inviteField = document.getElementById('invite-field');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');
const rules = Object.fromEntries([...document.querySelectorAll('#pw-rules li')].map((li) => [li.dataset.rule, li]));

let mode = 'closed';

function setRule(name, ok) {
  const li = rules[name];
  if (!li) return;
  const icon = li.querySelector('.material-symbols-outlined');
  icon.textContent = ok ? 'check_circle' : 'radio_button_unchecked';
  icon.classList.toggle('text-primary-container', ok);
  icon.classList.toggle('text-outline', !ok);
  li.classList.toggle('text-on-surface', ok);
}

function evaluate() {
  const email = form.email.value.trim().toLowerCase();
  const p = form.password.value;
  const p2 = form.password2.value;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  const local = email.split('@')[0];
  const checks = {
    length: p.length >= 12 && p.length <= 128,
    classes: classes >= 3,
    email: !(local.length >= 4 && p.toLowerCase().includes(local)),
    match: p.length > 0 && p === p2,
  };
  for (const [k, v] of Object.entries(checks)) setRule(k, v);
  const ok = Object.values(checks).every(Boolean) && form.email.checkValidity() && form.terms.checked && (mode !== 'invite' || form.invite.value.trim().length > 0);
  submitBtn.disabled = !ok;
}

['input', 'change'].forEach((ev) => form.addEventListener(ev, evaluate));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  successEl.classList.add('hidden');
  submitBtn.disabled = true;
  try {
    const res = await api.register({
      email: form.email.value.trim(),
      password: form.password.value,
      inviteCode: mode === 'invite' ? form.invite.value.trim() : undefined,
      acceptTerms: form.terms.checked,
    });
    if (res && res.user) {
      // Compte créé sur la formule gratuite : on enchaîne sur le choix d'une
      // formule (la page propose aussi de continuer en gratuit). Le bandeau de
      // confirmation d'adresse y est affiché si la vérification est active.
      window.location.href = res.verificationRequired ? '/tarifs.html?bienvenue=1&verif=1' : '/tarifs.html?bienvenue=1';
      return;
    }
    // Adresse déjà utilisée : réponse neutre du serveur, on renvoie vers la connexion.
    successEl.textContent = (res && res.message) || 'Compte créé. Connectez-vous.';
    successEl.classList.remove('hidden');
    setTimeout(() => (window.location.href = '/login.html'), 2500);
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? err.message : 'Erreur';
    errorEl.classList.remove('hidden');
    evaluate();
  }
});

// Déjà connecté → studio.
api
  .me({ silent: true })
  .then(() => {
    window.location.href = '/app.html';
  })
  .catch(() => {});

api
  .config()
  .then((cfg) => {
    mode = (cfg && cfg.registerMode) || 'closed';
    if (mode === 'closed') {
      modeHint.textContent = "Les inscriptions sont fermées : l'accès se fait sur invitation. Contactez l'administrateur.";
      return;
    }
    modeHint.textContent = mode === 'invite'
      ? "Un code d'invitation est nécessaire pour créer un compte."
      : 'Quelques secondes, et le studio est à vous.';
    inviteField.classList.toggle('hidden', mode !== 'invite');
    form.invite.required = mode === 'invite';
    form.classList.remove('hidden');
    evaluate();
  })
  .catch(() => {
    modeHint.textContent = 'Service indisponible, réessayez plus tard.';
  });
