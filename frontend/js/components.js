// Fragments d'UI réutilisables (design system "AdCraft Studio"), partagés entre
// le dashboard et l'historique. Un seul endroit à retoucher par composant.

// Source unique des thèmes (valeur envoyée au backend + libellé affiché).
export const THEMES = [
  { value: 'classique', label: 'Classique' },
  { value: 'ete', label: 'Été' },
  { value: 'extravagant', label: 'Extravagant' },
  { value: 'sport', label: 'Sport' },
  { value: 'fete', label: 'Nuit / Fête' },
  { value: 'luxe', label: 'Luxe' },
  { value: 'noel', label: 'Noël' },
];
export const THEME_LABELS = Object.fromEntries(THEMES.map((t) => [t.value, t.label]));

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// created_at stocké en UTC "YYYY-MM-DD HH:MM:SS".
export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function productLabel(g) {
  return [g.brand, g.flavor].filter(Boolean).join(' · ') || g.brand || '—';
}

// En-tête d'usage : consommation du mois courant. Accord (image/images) et
// séparateur décimal français (virgule). Ex : "1 image · 0,04 € ce mois".
export function usageLabel(u) {
  const n = u.currentMonth.count;
  const eur = u.currentMonth.eur.toFixed(2).replace('.', ',');
  return `${n} image${n > 1 ? 's' : ''} · ${eur} € ce mois`;
}

// Vignette cassée (404, image corrompue) OU sortie dégénérée 1×1 (n8n/Gemini) :
// bascule sur un placeholder explicite plutôt qu'un rectangle noir muet.
// À placer juste APRÈS le <img> ciblé (le handler vise nextElementSibling).
export const IMG_FALLBACK_ATTRS =
  `onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')" ` +
  `onload="if(this.naturalWidth<=1||this.naturalHeight<=1){this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')}"`;

export function brokenThumb() {
  return `<div class="js-broken hidden absolute inset-0 flex-col items-center justify-center gap-xs bg-surface-container-low text-secondary text-center p-sm flex">
      <span class="material-symbols-outlined text-[28px]">broken_image</span>
      <span class="font-label-sm text-label-sm">Aperçu indisponible</span>
    </div>`;
}

// Tuiles de thème : libellé seul (minimaliste). État actif (bordure accent +
// fond légèrement teinté + coche) géré par app.js.
export function renderThemeButtons() {
  return THEMES.map(
    (t) => `
      <button type="button" data-theme="${t.value}"
        class="theme-btn relative rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-md flex items-center justify-between gap-sm text-left hover:border-primary-container transition-colors focus:outline-none focus:ring-2 focus:ring-primary-container focus:ring-offset-2">
        <span class="theme-label font-label-md text-label-md text-on-surface">${escapeHtml(t.label)}</span>
        <span class="theme-check material-symbols-outlined text-primary-container text-[18px] hidden">check</span>
      </button>`
  ).join('');
}

// Carte d'une génération réussie. Overlay au survol : télécharger + supprimer.
export function successCard(g) {
  const label = productLabel(g);
  const themeLabel = THEME_LABELS[g.theme] || g.theme;
  return `
    <div class="js-card group flex flex-col gap-xs" data-id="${g.id}">
      <div class="relative aspect-[4/5] bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
        <img src="${g.url}" alt="${escapeHtml(label)}" class="w-full h-full object-cover" loading="lazy" ${IMG_FALLBACK_ATTRS} />
        ${brokenThumb()}
        <div class="absolute inset-0 bg-inverse-surface/40 backdrop-blur-[2px] flex items-center justify-center gap-md opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <a href="${g.url}?download=1" download title="Télécharger" aria-label="Télécharger"
             class="w-10 h-10 bg-surface-container-lowest rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container transition-colors border border-outline-variant">
            <span class="material-symbols-outlined text-[20px]">download</span>
          </a>
          <button type="button" class="js-delete w-10 h-10 bg-error text-on-error rounded-full flex items-center justify-center hover:opacity-90 transition-opacity"
                  data-id="${g.id}" title="Supprimer" aria-label="Supprimer">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
      </div>
      <div class="px-xs flex flex-col gap-xs">
        <span class="font-label-md text-label-md text-on-surface truncate">${escapeHtml(label)}</span>
        <div class="flex">
          <span class="bg-surface-container-low text-secondary px-xs py-[2px] rounded font-label-sm text-label-sm">${escapeHtml(themeLabel)}</span>
        </div>
        <span class="font-label-sm text-label-sm text-secondary">${fmtDate(g.createdAt)}</span>
      </div>
    </div>`;
}

// Ligne compacte d'un échec : produit, date, message d'erreur brut (jamais
// masqué — c'est lui qui explique : timeout, quota, credential).
export function failureRow(g, { withRetry = true } = {}) {
  const themeLabel = THEME_LABELS[g.theme] || g.theme;
  return `
    <li class="js-failure flex justify-between items-center gap-md py-sm border-b border-outline-variant last:border-0" data-id="${g.id}">
      <div class="flex flex-col min-w-0">
        <span class="font-label-md text-label-md text-on-surface truncate">${escapeHtml(productLabel(g))} <span class="text-secondary font-body-sm">· ${escapeHtml(
    themeLabel
  )} · ${fmtDate(g.createdAt)}</span></span>
        <span class="font-body-sm text-body-sm text-secondary break-words">Raison : ${escapeHtml(g.error || 'Erreur inconnue')}</span>
      </div>
      <div class="flex gap-xs shrink-0">
        ${
          withRetry
            ? `<button type="button" class="js-retry px-sm py-xs bg-surface-container-lowest border border-outline-variant rounded text-on-surface font-label-sm text-label-sm hover:bg-surface-container transition-colors" data-id="${g.id}">Relancer</button>`
            : ''
        }
        <button type="button" class="js-delete px-sm py-xs bg-error text-on-error rounded font-label-sm text-label-sm hover:opacity-90 transition-opacity" data-id="${g.id}">Supprimer</button>
      </div>
    </li>`;
}

// Bandeau des échecs repliable (<details> natif). Rien si aucun échec.
export function failuresBlock(errorCount) {
  if (!errorCount) return '';
  const n = errorCount;
  const plural = n > 1 ? 's' : '';
  return `
    <details class="js-failures group bg-surface-container-low border-l-2 border-l-error border-y border-r border-outline-variant rounded-lg overflow-hidden" data-count="${n}">
      <summary class="flex justify-between items-center p-md cursor-pointer list-none hover:bg-surface-container-highest transition-colors">
        <div class="flex items-center gap-sm text-on-surface">
          <span class="material-symbols-outlined text-[18px]">error_outline</span>
          <span class="js-failures-count font-headline-md text-headline-md">${n} génération${plural} échouée${plural}</span>
        </div>
        <span class="material-symbols-outlined text-on-surface transform group-open:rotate-180 transition-transform">expand_more</span>
      </summary>
      <ul class="js-failures-list p-md border-t border-outline-variant flex flex-col"></ul>
    </details>`;
}
