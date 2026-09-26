// Fragments d'UI réutilisables (design system Studio), partagés entre le
// dashboard et l'historique. Un seul endroit à retoucher par composant.
import { t, has, date as fmtLocale, relative, parseServerDate, money } from './i18n.js';

// Source unique des thèmes : la `value` est envoyée au backend et sert de clé
// de prompt — elle ne se traduit JAMAIS. Seul le libellé est localisé.
export const THEMES = [
  { value: 'classique', gradient: 'linear-gradient(135deg,#f3f4f3 0%,#e8e8e7 100%)' },
  { value: 'ete', gradient: 'linear-gradient(135deg,#fde9c8 0%,#f5c98d 100%)' },
  { value: 'extravagant', gradient: 'linear-gradient(135deg,#d6dcff 0%,#b7c4ff 100%)' },
  { value: 'sport', gradient: 'linear-gradient(135deg,#dfe4e6 0%,#b4bcc0 100%)' },
  { value: 'fete', gradient: 'linear-gradient(135deg,#3a3f57 0%,#1f2333 100%)' },
  { value: 'luxe', gradient: 'linear-gradient(135deg,#e9e1dd 0%,#ccc5c2 100%)' },
  { value: 'noel', gradient: 'linear-gradient(135deg,#dbe7e4 0%,#a9c6bf 100%)' },
].map((th) => ({ ...th, label: t(`themes.${th.value}`) }));

export const THEME_LABELS = Object.fromEntries(THEMES.map((th) => [th.value, th.label]));

// Libellé d'une catégorie produit. La valeur stockée est française (elle part
// dans le prompt) ; on la traduit pour l'affichage quand on la connaît, sinon
// on montre telle quelle ce que l'utilisateur a saisi.
export function categoryLabel(value) {
  if (!value) return '';
  const key = `categories.${String(value).toLowerCase().replace(/\s+/g, '_')}`;
  return has(key) ? t(key) : String(value);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// created_at stocké en UTC "YYYY-MM-DD HH:MM:SS".
export function fmtDate(s) {
  return fmtLocale(s, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Date relative pour les cartes d'historique (« Il y a 2 h », « Hier, 18:04 »,
// « 12 oct., 16:45 »). Intl.RelativeTimeFormat fait la formulation : pas de
// composition manuelle, sinon l'ordre des mots casse en néerlandais.
export function fmtRelative(s) {
  const d = parseServerDate(s);
  if (!d) return '';
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  const hhmm = fmtLocale(d, { hour: '2-digit', minute: '2-digit' });
  if (diffMin < 1) return t('time.now');
  if (diffMin < 60) return relative(-diffMin, 'minute');
  if (diffMin < 1440 && d.getDate() === now.getDate()) return relative(-Math.floor(diffMin / 60), 'hour');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
    return t('time.dayTime', { day: relative(-1, 'day', { numeric: 'auto' }), time: hhmm });
  }
  return t('time.dayTime', { day: fmtLocale(d, { day: 'numeric', month: 'short' }), time: hhmm });
}

export function productLabel(g) {
  return [g.brand, g.flavor].filter(Boolean).join(' · ') || g.brand || '—';
}

// En-tête d'usage. Le client ne voit jamais de montant (c'est notre prix de
// revient, pas son prix) : générations restantes quand la facturation est
// active (« 3 générations restantes »), sinon le nombre de visuels du mois.
// L'admin garde la conso chiffrée : « 1 image · 0,04 € ce mois ». Accord
// singulier/pluriel par Intl.PluralRules, montant par Intl.NumberFormat.
export function usageLabel(u) {
  const count = u.currentMonth.count;
  if (u.isAdmin && typeof u.currentMonth.eur === 'number') {
    return t('usage.header', { count, amount: money(u.currentMonth.eur) });
  }
  const b = u.billing;
  if (b && !b.unlimited && typeof b.remaining === 'number') {
    return b.remaining > 0 ? t('usage.remaining', { count: b.remaining }) : t('usage.remainingNone');
  }
  return t('usage.month', { count });
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
      <span class="font-label-sm text-label-sm">${escapeHtml(t('history.thumbUnavailable'))}</span>
    </div>`;
}

// Tuiles de thème : aperçu visuel (dégradé) + libellé sous la tuile. État actif
// (bordure accent 2px + pastille cochée) géré par app.js sur .theme-preview.
export function renderThemeButtons() {
  return THEMES.map(
    (th) => `
      <button type="button" data-theme="${th.value}" class="theme-btn flex flex-col gap-[5px] text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2">
        <div class="theme-preview h-[52px] lg:h-[44px] rounded-lg border border-outline-variant flex items-end justify-end p-[5px]" style="background:${th.gradient}">
          <span class="theme-check w-[14px] h-[14px] rounded-full bg-primary-container hidden items-center justify-center">
            <span class="material-symbols-outlined text-on-primary text-[9px]">check</span>
          </span>
        </div>
        <span class="theme-label font-label-sm text-label-sm text-on-surface-variant text-center">${escapeHtml(th.label)}</span>
      </button>`
  ).join('');
}

// Carte d'une génération réussie (maquette Historique) : image plein cadre 4:5,
// actions révélées au survol dans un dégradé bas, métadonnées sur trois lignes.
export function successCard(g) {
  const label = productLabel(g);
  const themeLabel = THEME_LABELS[g.theme] || g.theme;
  const download = escapeHtml(t('common.download'));
  const remove = escapeHtml(t('common.delete'));
  return `
    <div class="js-card group flex flex-col gap-sm" data-id="${g.id}">
      <div class="relative aspect-[4/5] bg-surface-container-low border border-outline-variant rounded-lg overflow-hidden">
        <img src="${g.url}" alt="${escapeHtml(label)}" class="w-full h-full object-cover" loading="lazy" ${IMG_FALLBACK_ATTRS} />
        ${brokenThumb()}
        <div class="absolute inset-0 flex items-end justify-end gap-xs p-xs lg:p-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity z-10 lg:[background:linear-gradient(to_top,rgba(26,28,28,0.55)_0%,rgba(26,28,28,0)_42%)]">
          <a href="${g.url}?download=1" download title="${download}" aria-label="${download}"
             class="w-11 h-11 lg:w-[30px] lg:h-[30px] flex items-center justify-center group/act">
            <span class="w-[30px] h-[30px] bg-surface-container-lowest rounded flex items-center justify-center text-on-surface group-hover/act:bg-surface-container transition-colors">
              <span class="material-symbols-outlined text-[15px]">download</span>
            </span>
          </a>
          <button type="button" class="js-delete w-11 h-11 lg:w-[30px] lg:h-[30px] flex items-center justify-center group/act"
                  data-id="${g.id}" title="${remove}" aria-label="${remove}">
            <span class="w-[30px] h-[30px] bg-surface-container-lowest rounded flex items-center justify-center text-error group-hover/act:bg-surface-container transition-colors">
              <span class="material-symbols-outlined text-[15px]">delete</span>
            </span>
          </button>
        </div>
      </div>
      <div class="flex flex-col gap-xs">
        <span class="font-body-sm text-body-sm font-semibold text-on-surface truncate">${escapeHtml(label)}</span>
        <div class="flex items-center gap-sm">
          <span class="bg-surface-container text-on-surface-variant px-sm py-[2px] rounded-full font-label-sm text-label-sm">${escapeHtml(themeLabel)}</span>
          <span class="font-label-sm text-label-sm text-outline" title="${escapeHtml(fmtDate(g.createdAt))}">${escapeHtml(fmtRelative(g.createdAt))}</span>
        </div>
      </div>
    </div>`;
}

// Ligne compacte d'un échec : produit, date, message d'erreur brut (jamais
// masqué — c'est lui qui explique : timeout, quota, credential).
export function failureRow(g, { withRetry = true } = {}) {
  const themeLabel = THEME_LABELS[g.theme] || g.theme;
  return `
    <li class="js-failure flex flex-col sm:flex-row sm:justify-between sm:items-center gap-sm sm:gap-md py-sm border-b border-outline-variant last:border-0" data-id="${g.id}">
      <div class="flex flex-col min-w-0">
        <span class="font-label-md text-label-md text-on-surface truncate">${escapeHtml(productLabel(g))} <span class="text-secondary font-body-sm">· ${escapeHtml(
    themeLabel
  )} · ${escapeHtml(fmtDate(g.createdAt))}</span></span>
        <span class="font-body-sm text-body-sm text-secondary break-words">${escapeHtml(
          t('history.failureReason', { message: g.error || t('history.unknownError') })
        )}</span>
      </div>
      <div class="flex gap-xs shrink-0">
        ${
          withRetry
            ? `<button type="button" class="js-retry px-sm py-xs min-h-[44px] lg:min-h-0 inline-flex items-center bg-surface-container-lowest border border-outline-variant rounded text-on-surface font-label-sm text-label-sm hover:bg-surface-container transition-colors" data-id="${g.id}">${escapeHtml(t('common.retry'))}</button>`
            : ''
        }
        <button type="button" class="js-delete px-sm py-xs min-h-[44px] lg:min-h-0 inline-flex items-center bg-error text-on-error rounded font-label-sm text-label-sm hover:opacity-90 transition-opacity" data-id="${g.id}">${escapeHtml(t('common.delete'))}</button>
      </div>
    </li>`;
}

// Bandeau des échecs repliable (<details> natif). Rien si aucun échec.
export function failuresBlock(errorCount) {
  if (!errorCount) return '';
  const count = errorCount;
  return `
    <details class="js-failures group bg-surface-container-low border border-outline-variant rounded overflow-hidden" data-count="${count}">
      <summary class="flex justify-between items-center gap-sm px-md py-sm min-h-[44px] lg:min-h-0 cursor-pointer list-none hover:bg-surface-container transition-colors">
        <div class="flex items-center gap-sm text-on-surface-variant">
          <span class="material-symbols-outlined text-outline text-[15px]">error_outline</span>
          <span class="js-failures-count font-label-md text-label-md">${escapeHtml(t('history.failuresCount', { count }))}</span>
        </div>
        <span class="material-symbols-outlined text-outline transform group-open:rotate-180 transition-transform">expand_more</span>
      </summary>
      <ul class="js-failures-list p-md border-t border-outline-variant flex flex-col"></ul>
    </details>`;
}
