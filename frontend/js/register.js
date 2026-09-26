// Inscription : contrôle en direct des critères (miroir de backend/src/password.js —
// le serveur reste l'autorité), code d'invitation selon REGISTER_MODE, CGU,
// offre d'essai (quota gratuit servi par /api/auth/config).
import { api, ApiError } from './api.js';
import { t, currentLang, DEFAULT_LANG } from './i18n.js';
import { renderLangCompact, wireLangLinks } from './nav.js';

const slot = document.getElementById('lang-slot');
if (slot) {
  slot.innerHTML = renderLangCompact();
  wireLangLinks(slot);
}

const form = document.getElementById('register-form');
const modeHint = document.getElementById('mode-hint');
const inviteField = document.getElementById('invite-field');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');
const pwToggle = document.getElementById('pw-toggle');
const rules = Object.fromEntries([...document.querySelectorAll('#pw-rules li')].map((li) => [li.dataset.rule, li]));

let mode = 'closed';

// --- Offre d'essai ------------------------------------------------------------
// « 5 visuels offerts, sans carte bancaire » : 5 tant que la configuration n'est
// pas arrivée, ou si un backend plus ancien n'expose pas freeQuota.
const DEFAULT_FREE_QUOTA = 5;
const readQuota = (cfg) => {
  const q = Number(cfg && cfg.freeQuota);
  return Number.isInteger(q) && q >= 0 ? q : DEFAULT_FREE_QUOTA;
};
// Textes qui dépendent du quota : data-quota-i18n="cle" → t(cle, { count }).
// Appelé tout de suite (avant le premier affichage) puis à l'arrivée de la
// configuration. La visibilité initiale est celle du HTML : l'encart au-dessus
// du formulaire n'apparaît qu'avec lui.
function applyQuota(count) {
  document.querySelectorAll('[data-quota-i18n="home.cta.offer"]').forEach((el) => {
    el.textContent = t('home.cta.offer', { count });
  });
}
// Pas de promesse d'essai si l'inscription est fermée ou le quota offert nul.
const showOffer = (visible) => document.querySelectorAll('[data-offer]').forEach((el) => el.classList.toggle('hidden', !visible));
applyQuota(DEFAULT_FREE_QUOTA);

// --- Afficher / masquer le mot de passe ----------------------------------------
// Remplace le champ de confirmation : on vérifie sa saisie en la lisant plutôt
// qu'en la tapant deux fois.
function setPasswordVisible(visible) {
  form.password.type = visible ? 'text' : 'password';
  pwToggle.setAttribute('aria-pressed', String(visible));
  pwToggle.querySelector('.material-symbols-outlined').textContent = visible ? 'visibility_off' : 'visibility';
}
pwToggle.addEventListener('click', () => {
  setPasswordVisible(pwToggle.getAttribute('aria-pressed') !== 'true');
  form.password.focus();
});

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
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  const local = email.split('@')[0];
  const checks = {
    length: p.length >= 12 && p.length <= 128,
    classes: classes >= 3,
    email: !(local.length >= 4 && p.toLowerCase().includes(local)),
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
  // Remasqué à l'envoi : le mot de passe ne reste pas lisible à l'écran pendant
  // la redirection, et les gestionnaires de mots de passe le reconnaissent.
  setPasswordVisible(false);
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
    // Le message du serveur est en français : hors FR, notre clé (même formulation neutre).
    successEl.textContent = (currentLang() === DEFAULT_LANG && res && res.message) || t('register.created');
    successEl.classList.remove('hidden');
    setTimeout(() => (window.location.href = '/login.html'), 2500);
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? err.message : t('errors.generic');
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
    const quota = readQuota(cfg);
    if (mode === 'closed') {
      modeHint.textContent = t('register.modeClosed');
      showOffer(false);
      return;
    }
    modeHint.textContent = mode === 'invite' ? t('register.modeInvite') : t('register.modeOpen');
    applyQuota(quota);
    showOffer(quota > 0);
    inviteField.classList.toggle('hidden', mode !== 'invite');
    form.invite.required = mode === 'invite';
    form.classList.remove('hidden');
    evaluate();
  })
  .catch(() => {
    modeHint.textContent = t('register.unavailable');
    showOffer(false);
  });
