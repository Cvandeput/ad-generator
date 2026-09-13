// Fragments d'UI réutilisables (design system "AdCraft Studio"), partagés entre
// le dashboard et l'historique. Un seul endroit à retoucher par composant.

// Source unique des thèmes (valeur envoyée au backend + libellé affiché +
// dégradé d'aperçu de la tuile, repris de la maquette Studio).
export const THEMES = [
  { value: 'classique', label: 'Classique', gradient: 'linear-gradient(135deg,#f3f4f3 0%,#e8e8e7 100%)' },
  { value: 'ete', label: 'Été', gradient: 'linear-gradient(135deg,#fde9c8 0%,#f5c98d 100%)' },
  { value: 'extravagant', label: 'Extravagant', gradient: 'linear-gradient(135deg,#d6dcff 0%,#b7c4ff 100%)' },
  { value: 'sport', label: 'Sport', gradient: 'linear-gradient(135deg,#dfe4e6 0%,#b4bcc0 100%)' },
  { value: 'fete', label: 'Nuit', gradient: 'linear-gradient(135deg,#3a3f57 0%,#1f2333 100%)' },
  { value: 'luxe', label: 'Luxe', gradient: 'linear-gradient(135deg,#e9e1dd 0%,#ccc5c2 100%)' },
  { value: 'noel', label: 'Noël', gradient: 'linear-gradient(135deg,#dbe7e4 0%,#a9c6bf 100%)' },
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

// Date relative pour les cartes d'historique (maquette : « Il y a 2 h »,
// « Hier, 18:04 », « 12 oct., 16:45 »). created_at stocké en UTC.
export function fmtRelative(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  const hhmm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  if (diffMin < 1440 && d.getDate() === now.getDate()) return `Il y a ${Math.floor(diffMin / 60)} h`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
    return `Hier, ${hhmm}`;
  }
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}, ${hhmm}`;
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
// Sans handler inline (interdit par la CSP) : un écouteur global en phase de
// capture (les événements error/load des <img> ne remontent pas).
// À placer juste APRÈS le <img data-fallback> ciblé.
export const IMG_FALLBACK_ATTRS = 'data-fallback="1"';

function swapToFallback(img) {
  img.classList.add('hidden');
  img.nextElementSibling?.classList.remove('hidden');
}
let fallbackWired = false;
export function wireImageFallbacks() {
  if (fallbackWired) return;
  fallbackWired = true;
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.dataset.fallback) swapToFallback(img);
    },
    true
  );
  document.addEventListener(
    'load',
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.dataset.fallback && (img.naturalWidth <= 1 || img.naturalHeight <= 1)) swapToFallback(img);
    },
    true
  );
}

export function brokenThumb() {
  return `<div class="js-broken hidden absolute inset-0 flex-col items-center justify-center gap-xs bg-surface-container-low text-secondary text-center p-sm flex">
      <span class="material-symbols-outlined text-[28px]">broken_image</span>
      <span class="font-label-sm text-label-sm">Aperçu indisponible</span>
    </div>`;
}

// Tuiles de thème : aperçu visuel (dégradé) + libellé sous la tuile. État actif
// (bordure accent 2px + pastille cochée) géré par app.js sur .theme-preview.
export function renderThemeButtons() {
  return THEMES.map(
    (t) => `
      <button type="button" data-theme="${t.value}" class="theme-btn flex flex-col gap-[5px] text-left focus:outline-none">
        <div class="theme-preview h-[52px] rounded-lg border border-outline-variant flex items-end justify-end p-[5px]" style="background:${t.gradient}">
          <span class="theme-check w-[14px] h-[14px] rounded-full bg-primary-container hidden items-center justify-center">
            <span class="material-symbols-outlined text-on-primary text-[9px]">check</span>
          </span>
        </div>
        <span class="theme-label font-label-sm text-label-sm text-on-surface-variant text-center">${escapeHtml(t.label)}</span>
      </button>`
  ).join('');
}

// Carte d'une génération réussie (maquette Historique) : image plein cadre 4:5,
// actions révélées au survol dans un dégradé bas, métadonnées sur trois lignes.
export function successCard(g) {
  const label = productLabel(g);
  const themeLabel = THEME_LABELS[g.theme] || g.theme;
  return `
    <div class="js-card group flex flex-col gap-sm" data-id="${g.id}">
      <div class="relative aspect-[4/5] bg-surface-container-low border border-outline-variant rounded-lg overflow-hidden">
        <img src="${g.url}" alt="${escapeHtml(label)}" class="w-full h-full object-cover" loading="lazy" ${IMG_FALLBACK_ATTRS} />
        ${brokenThumb()}
        <div class="absolute inset-0 flex items-end justify-end gap-xs p-sm opacity-0 group-hover:opacity-100 transition-opacity z-10"
             style="background:linear-gradient(to top,rgba(26,28,28,0.55) 0%,rgba(26,28,28,0) 42%)">
          <a href="${g.url}?download=1" download title="Télécharger" aria-label="Télécharger"
             class="w-[30px] h-[30px] bg-surface-container-lowest rounded flex items-center justify-center text-on-surface hover:bg-surface-container transition-colors">
            <span class="material-symbols-outlined text-[15px]">download</span>
          </a>
          <button type="button" class="js-delete w-[30px] h-[30px] bg-surface-container-lowest rounded flex items-center justify-center text-error hover:bg-surface-container transition-colors"
                  data-id="${g.id}" title="Supprimer" aria-label="Supprimer">
            <span class="material-symbols-outlined text-[15px]">delete</span>
          </button>
        </div>
      </div>
      <div class="flex flex-col gap-xs">
        <span class="font-body-sm text-body-sm font-semibold text-on-surface truncate">${escapeHtml(label)}</span>
        <div class="flex items-center gap-sm">
          <span class="bg-surface-container text-on-surface-variant px-sm py-[2px] rounded-full font-label-sm text-label-sm">${escapeHtml(themeLabel)}</span>
          <span class="font-label-sm text-label-sm text-outline" title="${fmtDate(g.createdAt)}">${fmtRelative(g.createdAt)}</span>
        </div>
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
    <details class="js-failures group bg-surface-container-low border border-outline-variant rounded overflow-hidden" data-count="${n}">
      <summary class="flex justify-between items-center gap-sm px-md py-sm cursor-pointer list-none hover:bg-surface-container transition-colors">
        <div class="flex items-center gap-sm text-on-surface-variant">
          <span class="material-symbols-outlined text-outline text-[15px]">error_outline</span>
          <span class="js-failures-count font-label-md text-label-md">${n} génération${plural} échouée${plural}</span>
        </div>
        <span class="material-symbols-outlined text-outline transform group-open:rotate-180 transition-transform">expand_more</span>
      </summary>
      <ul class="js-failures-list p-md border-t border-outline-variant flex flex-col"></ul>
    </details>`;
}
