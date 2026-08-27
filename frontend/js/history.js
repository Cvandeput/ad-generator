// Page historique : filtres (recherche marque, catégorie, thème, tri) + échecs.
// N'affiche que les réussites ; les échecs sont signalés par le bandeau repliable.
import { api, requireUser } from './api.js';
import { successCard, failuresBlock, THEME_LABELS, usageLabel } from './components.js';
import { wireGridDeletes, wireFailures } from './ui.js';

const PAGE = 12; // multiple des colonnes de la grille (2/3/4) → pas de trous

const gridEl = document.getElementById('grid');
const failuresEl = document.getElementById('failures');
const loadMoreWrap = document.getElementById('load-more');
const loadMoreBtn = document.getElementById('load-more-btn');
const fCategory = document.getElementById('f-category');
const fTheme = document.getElementById('f-theme');
const fBrand = document.getElementById('f-brand');
const fSort = document.getElementById('f-sort');

let all = [];
let shown = PAGE; // nombre de cartes affichées (pagination "Charger plus")

// --- Auth guard ---
requireUser()
  .then((user) => {
    document.getElementById('user-email').textContent = user.email;
    document.getElementById('logout').title = `Déconnexion (${user.email})`;
    loadUsage();
    load();
  })
  .catch(() => {}); // 401 → redirigé par api.js

document.getElementById('logout').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  window.location.href = '/login.html';
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
    fCategory.appendChild(option(c, c));
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
  const rows = filteredRows();

  if (rows.length) {
    gridEl.innerHTML = rows.slice(0, shown).map((g) => successCard(g)).join('');
    loadMoreWrap.classList.toggle('hidden', rows.length <= shown);
    return;
  }

  loadMoreWrap.classList.add('hidden');
  // État vide explicite : distingue "rien du tout" de "que des échecs".
  const hasFailures = failuresEl.querySelector('details.js-failures');
  gridEl.innerHTML = `
    <div class="col-span-full border border-outline-variant border-dashed rounded-xl h-[360px] flex flex-col items-center justify-center text-center p-lg bg-surface-container-low/30">
      <div class="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-md">
        <span class="material-symbols-outlined text-[32px] text-secondary">image_not_supported</span>
      </div>
      <h2 class="font-headline-md text-headline-md text-on-surface mb-xs">Aucun résultat</h2>
      <p class="font-body-base text-body-base text-secondary max-w-md">${
        hasFailures
          ? 'Aucune génération réussie pour cette sélection — dépliez les échecs ci-dessus pour comprendre.'
          : 'Aucun visuel généré pour le moment. Lancez une génération pour voir vos créations ici.'
      }</p>
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
document.getElementById('reset').addEventListener('click', () => {
  fCategory.value = '';
  fTheme.value = '';
  fBrand.value = '';
  fSort.value = 'date-desc';
  rerenderFromFilters();
});

async function loadUsage() {
  try {
    document.getElementById('usage-header').textContent = usageLabel(await api.usage());
  } catch {
    /* silencieux */
  }
}
