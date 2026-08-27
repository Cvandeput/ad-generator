// Comportements interactifs partagés (suppression, bandeau échecs, relance).
// Séparé de components.js (markup pur) : ici le câblage DOM, une seule fois.

import { api, ApiError } from './api.js';
import { failureRow, escapeHtml } from './components.js';

const DELETE_CONFIRM = 'Supprimer définitivement cette génération ?\nLe visuel généré sera perdu, cette action est irréversible.';

function errMsg(err, fallback) {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

// Suppression depuis la grille : retrait optimiste de la carte, restauration si
// l'appel échoue.
export function wireGridDeletes(gridEl, { onDeleted } = {}) {
  gridEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-delete');
    if (!btn) return;
    const card = btn.closest('.js-card');
    const id = Number(btn.dataset.id);
    if (!card || !id) return;
    if (!confirm(DELETE_CONFIRM)) return;

    const parent = card.parentNode;
    const anchor = card.nextSibling;
    card.remove(); // optimiste
    try {
      await api.remove(id);
      onDeleted?.(id);
    } catch (err) {
      parent.insertBefore(card, anchor); // restaure à sa place
      alert(errMsg(err, 'La suppression a échoué.'));
    }
  });
}

function setFailuresCount(details, n) {
  details.dataset.count = String(n);
  const label = details.querySelector('.js-failures-count');
  if (label) label.textContent = `${n} génération${n > 1 ? 's' : ''} échouée${n > 1 ? 's' : ''}`;
  if (n <= 0) details.remove();
}

// Bandeau des échecs (<details> natif) : chargement paresseux au premier
// dépliage, suppression et relance ligne à ligne.
//   onResolved() : appelé après une relance réussie (recharge grille + compteurs).
export function wireFailures(rootEl, { withRetry = true, onResolved } = {}) {
  const details = rootEl.querySelector('details.js-failures');
  if (!details) return;
  const list = details.querySelector('.js-failures-list');
  let loaded = false;

  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    list.innerHTML = '<li class="py-sm font-body-sm text-body-sm text-secondary">Chargement…</li>';
    try {
      const { items } = await api.history('error');
      list.innerHTML =
        items.map((g) => failureRow(g, { withRetry })).join('') ||
        '<li class="py-sm font-body-sm text-body-sm text-secondary">Aucun échec.</li>';
      loaded = true;
    } catch (err) {
      list.innerHTML = `<li class="py-sm font-body-sm text-body-sm text-error">${escapeHtml(errMsg(err, 'Chargement impossible.'))}</li>`;
    }
  });

  list.addEventListener('click', async (e) => {
    const row = e.target.closest('.js-failure');
    if (!row) return;
    const id = Number(row.dataset.id);

    if (e.target.closest('.js-delete')) {
      if (!confirm(DELETE_CONFIRM)) return;
      const parent = row.parentNode;
      const anchor = row.nextSibling;
      row.remove(); // optimiste
      try {
        await api.remove(id);
        setFailuresCount(details, Number(details.dataset.count || 0) - 1);
      } catch (err) {
        parent.insertBefore(row, anchor);
        alert(errMsg(err, 'La suppression a échoué.'));
      }
      return;
    }

    if (e.target.closest('.js-retry')) {
      const btn = e.target.closest('.js-retry');
      btn.disabled = true;
      btn.textContent = 'Relance…';
      try {
        await api.retry(id); // crée une nouvelle ligne (journal) ; l'échec reste
        onResolved?.(); // recharge : la réussite apparaît, compteurs à jour
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Relancer';
        alert(errMsg(err, 'La relance a échoué.'));
      }
    }
  });
}
