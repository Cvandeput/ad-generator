// Page « Mon compte » : formule et consommation, mot de passe, langue,
// sessions et suppression du compte (art. 17 RGPD, déplacée depuis la page
// tarifs). Page privée : sans session, mountChrome renvoie vers /login.html.
import { api, ApiError } from './api.js';
import { escapeHtml } from './components.js';
import { mountChrome } from './nav.js';
import { openModal, BTN_DANGER } from './modal.js';
import { t, tList, has, date, currentLang, DEFAULT_LANG, renderLanguageSwitch, wireLanguageSwitch } from './i18n.js';

const mainEl = document.getElementById('account-main');
const planEl = document.getElementById('plan');

const BTN = 'min-h-[44px] lg:min-h-0 lg:h-9 py-xs px-lg rounded font-label-md text-label-md text-center leading-tight inline-flex items-center justify-center gap-xs transition-colors';
const BTN_GHOST = `${BTN} border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container disabled:opacity-60`;

let user = null;

function notice(kind, text) {
  const tone = kind === 'ok'
    ? 'bg-surface-container-low border-outline-variant text-on-surface-variant'
    : 'bg-error-container border-error text-on-error-container';
  return `<div class="border rounded-lg px-md py-sm font-body-sm text-body-sm ${tone}"${kind === 'ok' ? '' : ' role="alert"'}>${text}</div>`;
}

// --- (a) Formule et consommation ---------------------------------------------
// Même lecture que l'encart « Votre formule » de js/tarifs.js (GET
// /api/billing/subscription) ; les actions de paiement restent sur Tarifs.
const planLabel = (key, fallback) => (has(`plans.${key}.label`) ? t(`plans.${key}.label`) : fallback || key);
const fmtDate = (s) => date(s, { day: '2-digit', month: 'long', year: 'numeric' });

async function renderPlan() {
  let s;
  try {
    s = await api.billing.subscription();
  } catch {
    // Facturation coupée côté serveur (404) ou indisponible : pas d'encart.
    planEl.classList.add('hidden');
    return;
  }
  if (!s) return;
  // Compte admin : quota illimité (le serveur renvoie quota = null).
  const pct = s.unlimited ? 0 : s.quota > 0 ? Math.min(100, Math.round((s.used / s.quota) * 100)) : 100;
  planEl.classList.remove('hidden');
  planEl.innerHTML = `
    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col md:flex-row md:items-center gap-lg">
      <div class="flex flex-col gap-xs flex-grow min-w-0">
        <span id="plan-title" class="font-label-sm text-label-sm font-semibold tracking-[0.08em] uppercase text-secondary">${escapeHtml(t('pricing.current.label'))}</span>
        <span class="font-headline-md text-headline-md text-on-surface">${escapeHtml(planLabel(s.planKey, s.planLabel))}${s.status === 'past_due' ? ` ${t('pricing.current.pastDue_html')}` : ''}</span>
        <span class="font-body-sm text-body-sm text-secondary">
          ${escapeHtml(s.unlimited
            ? t('pricing.current.unlimited', { used: s.used })
            : t('pricing.current.used', { used: s.used, quota: s.quota }))}${s.credits ? escapeHtml(t('pricing.current.credits', { count: s.credits })) : ''}
          ${s.lifetime ? '' : s.periodEnd ? escapeHtml(t('pricing.current.renew', { date: fmtDate(s.periodEnd) })) : ''}
          ${s.cancelAtPeriodEnd ? escapeHtml(t('pricing.current.cancelScheduled')) : ''}
        </span>
        <div class="progress-track mt-xs max-w-[420px]"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div>
      <div class="flex gap-sm flex-shrink-0 flex-wrap">
        <a href="/app.html" class="${BTN_GHOST}">${escapeHtml(t('pricing.current.openStudio'))}</a>
        <a href="/tarifs.html" class="${BTN_GHOST}">${escapeHtml(t('account.plan.seePlans'))}<span class="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_forward</span></a>
      </div>
    </div>`;
}

// --- (b) Changement de mot de passe --------------------------------------------
const pwForm = document.getElementById('pw-form');
const pwCurrent = document.getElementById('pw-current');
const pwNew = document.getElementById('pw-new');
const pwSubmit = document.getElementById('pw-submit');
const pwFeedback = document.getElementById('pw-feedback');
const pwOpen = document.getElementById('pw-open');
const pwOpenRow = document.getElementById('pw-open-row');
const pwCancel = document.getElementById('pw-cancel');
const pwStatus = document.getElementById('pw-status');
const rules = Object.fromEntries([...document.querySelectorAll('#pw-rules li')].map((li) => [li.dataset.rule, li]));

function setRule(name, ok) {
  const li = rules[name];
  if (!li) return;
  const icon = li.querySelector('.material-symbols-outlined');
  icon.textContent = ok ? 'check_circle' : 'radio_button_unchecked';
  icon.classList.toggle('text-primary-container', ok);
  icon.classList.toggle('text-outline', !ok);
  li.classList.toggle('text-on-surface', ok);
}

// Miroir des règles de backend/src/password.js (comme register.js). Le serveur
// en applique d'autres (liste de mots de passe courants, suites, répétitions) :
// ses refus s'affichent au retour.
function evaluate() {
  const p = pwNew.value;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  const local = String(user?.email || '').split('@')[0].toLowerCase();
  const checks = {
    length: p.length >= 12 && p.length <= 128,
    classes: classes >= 3,
    email: p.length > 0 && !(local.length >= 4 && p.toLowerCase().includes(local)),
    different: p.length > 0 && p !== pwCurrent.value,
  };
  for (const [k, v] of Object.entries(checks)) setRule(k, v);
  pwSubmit.disabled = !(pwCurrent.value && Object.values(checks).every(Boolean));
}

// Afficher / masquer : bouton à bascule (aria-pressed), libellé constant.
document.querySelectorAll('.js-toggle-pw').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.getAttribute('aria-controls'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.querySelector('.material-symbols-outlined').textContent = show ? 'visibility_off' : 'visibility';
  });
});

// api.changePassword ne redirige pas sur 401 : le serveur répond 401 à un mot
// de passe actuel erroné (sans code métier). On reste sur la page pour
// afficher l'erreur, et on distingue la vraie session expirée via /api/auth/me.
const postPassword = (currentPassword, newPassword) => api.changePassword(currentPassword, newPassword);

// Message affiché pour un refus du serveur. En français, on garde le message
// du serveur quand il existe (même politique que api.js) ; ailleurs, nos clés.
function passwordError(err) {
  const fr = currentLang() === DEFAULT_LANG && err.serverMessage;
  if (err.status === 401) return fr ? err.serverMessage : t('account.password.errors.badCurrent');
  if (err.status === 400) {
    if (fr) return err.serverMessage;
    return err.data && Array.isArray(err.data.issues) ? t('account.password.errors.rejected') : t('account.password.errors.same');
  }
  if (err.status === 0) return t('errors.network');
  if (err.status === 429) return t('errors.status.429');
  return fr ? err.serverMessage : err.status >= 500 ? t('errors.status.500') : t('errors.generic');
}

// Formulaire replié derrière le bouton « Changer de mot de passe » : il ne
// s'ouvre que sur demande et demande d'abord le mot de passe actuel.
function resetPasswordForm() {
  pwForm.reset();
  pwCurrent.type = 'password';
  pwNew.type = 'password';
  document.querySelectorAll('.js-toggle-pw').forEach((b) => {
    b.setAttribute('aria-pressed', 'false');
    b.querySelector('.material-symbols-outlined').textContent = 'visibility';
  });
  pwFeedback.innerHTML = '';
  evaluate();
}
function openPasswordForm() {
  pwStatus.innerHTML = '';
  pwForm.classList.remove('hidden');
  pwOpenRow.classList.add('hidden');
  pwOpen.setAttribute('aria-expanded', 'true');
  pwCurrent.focus();
}
function closePasswordForm() {
  resetPasswordForm();
  pwForm.classList.add('hidden');
  pwOpenRow.classList.remove('hidden');
  pwOpen.setAttribute('aria-expanded', 'false');
  pwOpen.focus();
}
pwOpen.addEventListener('click', openPasswordForm);
pwCancel.addEventListener('click', closePasswordForm);
pwForm.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePasswordForm();
});

pwForm.addEventListener('input', () => {
  // Nouvelle saisie : le message précédent (erreur ou succès) n'a plus lieu d'être.
  pwFeedback.innerHTML = '';
  evaluate();
});
pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  evaluate();
  if (pwSubmit.disabled) return;
  pwFeedback.innerHTML = '';
  pwSubmit.disabled = true;
  pwSubmit.textContent = t('account.password.saving');
  try {
    await postPassword(pwCurrent.value, pwNew.value);
    // Le serveur a détruit TOUTES les sessions du compte puis rouvert
    // celle-ci : on le dit, les autres appareils vont se retrouver déconnectés.
    closePasswordForm();
    pwStatus.innerHTML = notice('ok', escapeHtml(t('account.password.success')));
  } catch (err) {
    // Trop d'essais : le serveur a fermé la session (quelqu'un d'autre que le
    // titulaire devant une session ouverte, peut-être). Retour à la connexion.
    if (err instanceof ApiError && err.code === 'SESSION_CLOSED') {
      location.href = '/login.html?motif=securite';
      return;
    }
    if (err instanceof ApiError && err.status === 401 && err.code !== 'BAD_CURRENT_PASSWORD') {
      // 401 sans code : la session a expiré entre-temps.
      const still = await api.me({ silent: true }).catch(() => null);
      if (!still) {
        location.href = '/login.html';
        return;
      }
    }
    let message = err instanceof ApiError ? passwordError(err) : t('errors.generic');
    const left = err instanceof ApiError ? err.data?.attemptsLeft : undefined;
    if (Number.isInteger(left) && left > 0) message += ` ${t('account.password.errors.attemptsLeft', { count: left })}`;
    pwFeedback.innerHTML = notice('err', escapeHtml(message));
    if (err instanceof ApiError && err.status === 401) {
      pwCurrent.select();
      pwCurrent.focus();
    }
  } finally {
    pwSubmit.textContent = t('account.password.submit');
    evaluate();
  }
});

// --- (e) Sessions ------------------------------------------------------------
document.getElementById('logout').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  await api.logout().catch(() => {});
  location.href = '/login.html';
});

document.getElementById('logout-all').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const res = await openModal({
    title: t('account.sessions.confirmTitle'),
    bodyHtml: `<p>${escapeHtml(t('account.sessions.confirmText'))}</p>`,
    confirmLabel: t('account.sessions.confirm'),
    confirmClass: BTN_DANGER,
    // Le serveur révoque chaque session du compte, y compris celle-ci.
    onConfirm: () => api.logoutAll(),
  });
  if (!res) return;
  btn.disabled = true;
  location.href = '/login.html';
});

// --- (d) Suppression du compte (art. 17) -------------------------------------
// Déplacée telle quelle depuis js/tarifs.js, avec ses garde-fous : aperçu de ce
// qui est effacé / conservé, case + mot de passe, 401 BAD_PASSWORD affiché sans
// redirection, 401 sans ce code = session expirée → connexion.
async function doDeleteAccount(btn) {
  let preview = { generations: 0, images: 0 };
  try { preview = await api.account.deletionPreview(); } catch { /* valeurs par défaut */ }

  const res = await openModal({
    title: t('account.delete.title'),
    // Trois blocs, dans cet ordre : ce qui est effacé, ce qui est conservé, et
    // POURQUOI. Une confirmation qui n'annonce que « êtes-vous sûr ? » ne permet
    // pas un consentement éclairé — et c'est précisément le reproche fait aux
    // suppressions de compte qui n'en sont pas.
    bodyHtml: `
      <p>${escapeHtml(t('account.delete.intro'))}</p>
      <p class="font-label-md text-label-md text-on-surface">${escapeHtml(t('account.delete.erasedTitle'))}</p>
      <ul class="list-disc pl-lg font-body-sm text-body-sm text-on-surface-variant flex flex-col gap-xs">
        ${tList('account.delete.erased', { count: preview.images })
          .map((li) => `<li>${escapeHtml(li)}</li>`).join('')}
      </ul>
      <p class="font-label-md text-label-md text-on-surface">${escapeHtml(t('account.delete.keptTitle'))}</p>
      <ul class="list-disc pl-lg font-body-sm text-body-sm text-on-surface-variant flex flex-col gap-xs">
        ${tList('account.delete.kept', { generations: preview.generations, years: preview.accountingYears ?? 7 })
          .map((li) => `<li>${escapeHtml(li)}</li>`).join('')}
      </ul>
      <p class="font-body-sm text-body-sm text-secondary">${escapeHtml(t('account.delete.why'))}</p>`,
    checkLabel: t('account.delete.checkbox'),
    passwordLabel: t('account.delete.password'),
    confirmLabel: t('account.delete.confirm'),
    confirmClass: BTN_DANGER,
    // Exécutée modale ouverte : un mot de passe erroné s'affiche DANS la
    // modale, qui reste ouverte pour une nouvelle saisie.
    onConfirm: async ({ password }) => {
      try {
        await api.account.remove(password, null);
      } catch (err) {
        // 401 sans BAD_PASSWORD : la session a expiré entre-temps (api.js ne
        // redirige pas sur cet appel, pour laisser afficher le mauvais mot de passe).
        if (err instanceof ApiError && err.status === 401 && err.code !== 'BAD_PASSWORD') {
          location.href = '/login.html';
          return new Promise(() => {}); // la navigation est en cours
        }
        // err.message est déjà localisé par api.js (errors.code.BAD_PASSWORD hors FR).
        throw new Error(err.message || t('pricing.errors.operationFailed'));
      }
    },
  });
  if (!res) return;

  btn.disabled = true;
  btn.textContent = t('common.loading');
  // Pas de message sur cette page : le compte n'existe plus, la session est
  // détruite. On renvoie vers l'accueil avec un accusé.
  location.href = '/?compte=supprime';
}

// --- Démarrage ---------------------------------------------------------------
user = await mountChrome({ requireAuth: true });
if (user) {
  mainEl.classList.remove('hidden');
  document.getElementById('signed-in').textContent = t('account.signedInAs', { email: user.email });
  document.getElementById('pw-username').value = user.email;

  // (c) Langue : le <select> d'i18n.js (mêmes ?lang= et localStorage).
  const slot = document.getElementById('lang-slot');
  slot.innerHTML = renderLanguageSwitch({ id: 'lang-account', full: true });
  wireLanguageSwitch(slot);

  const delBtn = document.getElementById('delete-account');
  if (user.isAdmin) {
    // Le serveur refuse (409 ADMIN_ACCOUNT) : on l'annonce au lieu de laisser
    // remplir une confirmation vouée à l'échec.
    document.getElementById('delete-admin').classList.remove('hidden');
    delBtn.disabled = true;
  } else {
    delBtn.addEventListener('click', () => doDeleteAccount(delBtn));
  }

  evaluate();
  renderPlan();
}
