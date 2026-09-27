// Page historique : filtres (recherche marque, catégorie, thème, tri) + échecs.
// N'affiche que les réussites ; les échecs sont signalés par le bandeau repliable.
import { api } from './api.js';
import { successCard, failuresBlock, THEME_LABELS, categoryLabel, wireImageFallbacks, escapeHtml } from './components.js';
import { wireGridDeletes, wireFailures } from './ui.js';
import { mountChrome, refreshUsage } from './nav.js';
import { t } from './i18n.js';

const PAGE = 12; // multiple des colonnes de la grille (2/3/4) → pas de trous

const gridEl = document.getElementById('grid');
const failuresEl = document.getElementById('failures');
const loadMoreWrap = document.getElementById('load-more');
const loadMoreBtn = document.getElementById('load-more-btn');
const fCategory = document.getElementById('f-category');
const fTheme = document.getElementById('f-theme');
const fBrand = document.getElementById('f-brand');
const fSort = document.getElementById('f-sort');
const toolbarEl = document.getElementById('toolbar');

const BTN_PRIMARY = 'min-h-[44px] lg:min-h-0 lg:h-9 px-lg py-xs rounded bg-primary-container text-on-primary inline-flex items-center justify-center gap-xs font-label-md text-label-md hover:bg-primary transition-colors';
const BTN_GHOST = 'min-h-[44px] lg:min-h-0 lg:h-9 px-lg py-xs rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant inline-flex items-center justify-center gap-xs font-label-md text-label-md hover:bg-surface-container transition-colors';

let all = [];
let shown = PAGE; // nombre de cartes affichées (pagination "Charger plus")

// --- Chrome commun + garde d'authentification ---
wireImageFallbacks();
mountChrome({ requireAuth: true }).then((user) => {
  if (user) load();
});

async function load() {
  try {
    const { items, counts } = await api.history('done');
    all = items;
    populateFilters();

    failuresEl.innerHTML = failuresBlock(counts.error);
    wireFailures(failuresEl, { withRetry: true, onResolved: () => { load(); loadUsage(); } });

    shown = PAGE;
    render();
  } catch {
    /* 401 déjà géré par api.js */
  }
}

// (Re)construit les options dynamiques sans les cumuler entre deux chargements.
function populateFilters() {
  resetSelect(fCategory);
  resetSelect(fTheme);
  for (const c of [...new Set(all.map((g) => g.category).filter(Boolean))].sort()) {
    fCategory.appendChild(option(c, categoryLabel(c)));
  }
  for (const t of [...new Set(all.map((g) => g.theme).filter(Boolean))]) {
    fTheme.appendChild(option(t, THEME_LABELS[t] || t));
  }
}

function resetSelect(sel) {
  while (sel.options.length > 1) sel.remove(1); // garde l'option "Toutes/Tous"
}
function option(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function filteredRows() {
  const cat = fCategory.value;
  const theme = fTheme.value;
  const brand = fBrand.value.trim().toLowerCase();
  const sort = fSort.value;

  const rows = all.filter((g) => {
    if (cat && g.category !== cat) return false;
    if (theme && g.theme !== theme) return false;
    if (brand && !(g.brand || '').toLowerCase().includes(brand)) return false;
    return true;
  });

  rows.sort((a, b) => {
    if (sort === 'brand-asc') return (a.brand || '').localeCompare(b.brand || '');
    if (sort === 'date-asc') return a.createdAt.localeCompare(b.createdAt);
    return b.createdAt.localeCompare(a.createdAt); // date-desc
  });
  return rows;
}

function render() {
  // Rien à filtrer tant que le compte n'a aucun visuel : la barre de filtres
  // n'apparaît qu'à partir du premier. Des filtres trop stricts, eux, la
  // laissent en place (avec un bouton pour tout réinitialiser).
  toolbarEl.classList.toggle('hidden', all.length === 0);
  const rows = filteredRows();

  if (rows.length) {
    gridEl.innerHTML = rows.slice(0, shown).map((g) => successCard(g)).join('');
    loadMoreWrap.classList.toggle('hidden', rows.length <= shown);
    return;
  }

  loadMoreWrap.classList.add('hidden');
  // Trois états vides distincts : aucun visuel du tout (on invite à créer le
  // premier), uniquement des échecs (on renvoie au bandeau), ou des filtres
  // qui ne retiennent rien (on propose de les réinitialiser).
  const hasFailures = failuresEl.querySelector('details.js-failures');
  const filtered = all.length > 0;
  const title = filtered ? t('history.empty.title') : t('history.empty.firstTitle');
  const text = filtered ? t('history.empty.filtered') : hasFailures ? t('history.empty.onlyFailures') : t('history.empty.none');
  const action = filtered
    ? `<button type="button" class="js-reset-filters ${BTN_GHOST}">${escapeHtml(t('history.empty.resetCta'))}</button>`
    : `<a href="/app.html" class="${BTN_PRIMARY}"><span class="material-symbols-outlined text-[16px]" aria-hidden="true">auto_awesome</span><span>${escapeHtml(t('history.empty.firstCta'))}</span></a>`;
  gridEl.innerHTML = `
    <div class="col-span-full border border-outline-variant border-dashed rounded-xl min-h-[360px] flex flex-col items-center justify-center text-center p-lg bg-surface-container-low/30">
      <div class="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-md">
        <span class="material-symbols-outlined text-[32px] text-secondary" aria-hidden="true">${filtered ? 'filter_alt_off' : 'image_not_supported'}</span>
      </div>
      <h2 class="font-headline-md text-headline-md text-on-surface mb-xs">${escapeHtml(title)}</h2>
      <p class="font-body-base text-body-base text-secondary max-w-md mb-lg">${escapeHtml(text)}</p>
      ${action}
    </div>`;
}

// Réinitialise la pagination à chaque changement de filtre (sinon "Charger plus"
// resterait sur un ancien seuil pour un jeu de résultats différent).
function rerenderFromFilters() {
  shown = PAGE;
  render();
}

// Suppression depuis la grille : retire aussi de `all` pour que le prochain
// render() ne fasse pas réapparaître la carte.
wireGridDeletes(gridEl, {
  onDeleted: (id) => {
    all = all.filter((g) => g.id !== id);
    render();
    loadUsage();
  },
});

loadMoreBtn.addEventListener('click', () => {
  shown += PAGE;
  render();
});

[fCategory, fTheme, fSort].forEach((el) => el.addEventListener('change', rerenderFromFilters));
fBrand.addEventListener('input', rerenderFromFilters);
function resetFilters() {
  fCategory.value = '';
  fTheme.value = '';
  fBrand.value = '';
  fSort.value = 'date-desc';
  rerenderFromFilters();
}
document.getElementById('reset').addEventListener('click', resetFilters);
// Bouton « Réinitialiser les filtres » de l'état vide (rendu dans la grille).
gridEl.addEventListener('click', (e) => {
  if (e.target.closest('.js-reset-filters')) resetFilters();
});

function loadUsage() {
  return refreshUsage();
}
