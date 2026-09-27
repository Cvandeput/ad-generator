// Modale réutilisable : consentement et rétractation (js/tarifs.js),
// suppression de compte et déconnexion globale (js/account.js).
//
// Même squelette que la modale de ré-acceptation des CGU (js/nav.js) : dialog
// modal, focus au clavier, fermeture par Échap. `confirm()` natif ne convient
// pas ici — il n'affiche ni case à cocher, ni champ de mot de passe, ni montant
// mis en forme, et il n'est pas traduisible.
//
//   const res = await openModal({ title, bodyHtml, confirmLabel, … });
//   res === null        → annulée (bouton, Échap, clic sur le fond)
//   res = { password }  → confirmée
//
// `onConfirm` (facultatif, asynchrone) : exécuté AU CLIC, modale encore
// ouverte. S'il lève une erreur, son message s'affiche DANS la modale, qui
// reste ouverte (mot de passe erroné : on ressaisit sans tout recommencer).
import { escapeHtml } from './components.js';
import { t } from './i18n.js';

const BTN = 'min-h-[44px] lg:min-h-0 lg:h-9 py-xs px-lg rounded font-label-md text-label-md text-center leading-tight flex items-center justify-center gap-xs transition-colors';
export const BTN_PRIMARY = `${BTN} bg-primary-container text-on-primary hover:bg-primary disabled:opacity-60`;
export const BTN_GHOST = `${BTN} border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container disabled:opacity-60`;
export const BTN_DANGER = `${BTN} bg-error text-on-error hover:opacity-90 disabled:opacity-60`;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openModal({ title, bodyHtml, checkLabel, passwordLabel, confirmLabel, confirmClass = BTN_PRIMARY, onConfirm }) {
  return new Promise((resolve) => {
    // Le focus revient à l'élément qui a ouvert la modale (bouton de la page).
    const opener = document.activeElement;
    const el = document.createElement('div');
    el.className = 'fixed inset-0 z-[70] bg-[rgba(26,28,28,0.55)] flex items-center justify-center p-lg overflow-y-auto';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'modal-title');
    el.innerHTML = `
      <div class="w-full max-w-[520px] my-auto bg-surface-container-lowest border border-outline-variant rounded-xl p-lg flex flex-col gap-md">
        <h2 id="modal-title" class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h2>
        <div class="font-body-base text-body-base text-on-surface-variant flex flex-col gap-sm">${bodyHtml}</div>
        ${checkLabel ? `
          <label class="flex items-start gap-sm cursor-pointer py-sm min-h-[44px]">
            <input type="checkbox" class="js-check mt-[2px] w-5 h-5 rounded border-outline text-primary-container focus:ring-primary-container" />
            <span class="font-body-sm text-body-sm text-on-surface">${escapeHtml(checkLabel)}</span>
          </label>` : ''}
        ${passwordLabel ? `
          <label class="flex flex-col gap-xs">
            <span class="font-label-md text-label-md text-on-surface">${escapeHtml(passwordLabel)}</span>
            <input type="password" autocomplete="current-password" maxlength="128" class="js-password h-11 px-md rounded border border-outline-variant bg-surface-container-lowest text-on-surface font-body-base focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container" />
          </label>` : ''}
        <p class="js-error font-body-sm text-body-sm text-error hidden" role="alert"></p>
        <div class="flex justify-end gap-sm flex-wrap">
          <button type="button" class="js-modal-cancel ${BTN_GHOST}">${escapeHtml(t('common.cancel'))}</button>
          <button type="button" class="js-confirm ${confirmClass}"${checkLabel ? ' disabled' : ''}>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    const check = el.querySelector('.js-check');
    const password = el.querySelector('.js-password');
    const confirm = el.querySelector('.js-confirm');
    const cancel = el.querySelector('.js-modal-cancel');
    const error = el.querySelector('.js-error');
    let busy = false; // requête `onConfirm` en cours : on ne ferme pas sous elle

    const showError = (msg) => {
      error.textContent = msg;
      error.classList.remove('hidden');
    };

    // La case n'est JAMAIS pré-cochée : un consentement pré-coché n'est pas un
    // consentement (art. 22 de la directive 2011/83, et bon sens).
    check?.addEventListener('change', () => (confirm.disabled = !check.checked));

    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      el.remove();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) close(null);
      // Piège à focus : Tab ne sort pas de la modale (aria-modal ne le fait pas).
      if (e.key === 'Tab') {
        const items = [...el.querySelectorAll(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);

    // `.js-modal-cancel` et non `.js-cancel` : cette dernière est interceptée par
    // l'écouteur global de la page tarifs, qui propose de RÉSILIER l'abonnement.
    cancel.addEventListener('click', () => { if (!busy) close(null); });
    el.addEventListener('click', (e) => { if (e.target === el && !busy) close(null); });
    confirm.addEventListener('click', async () => {
      if (passwordLabel && !password.value) {
        showError(t('account.delete.passwordRequired'));
        password.focus();
        return;
      }
      const value = { password: password ? password.value : null };
      if (!onConfirm) return close(value);

      busy = true;
      const label = confirm.textContent;
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.textContent = t('common.loading');
      error.classList.add('hidden');
      try {
        await onConfirm(value);
        busy = false;
        close(value);
      } catch (err) {
        busy = false;
        confirm.textContent = label;
        confirm.disabled = !!check && !check.checked;
        cancel.disabled = false;
        showError((err && err.message) || t('errors.generic'));
        if (password) {
          password.value = '';
          password.focus();
        }
      }
    });

    document.body.appendChild(el);
    (password || check || confirm).focus();
  });
}
