// Page historique dédiée : filtres (catégorie, thème, marque) + tri par date.

const THEME_LABELS = {
  classique: 'Classique',
  ete: 'Été',
  extravagant: 'Nouveau / Extravagant',
  sport: 'Sport / Énergie',
  fete: 'Nuit / Fête',
  luxe: 'Luxe / Premium',
  noel: 'Noël / Hiver',
};

const gridEl = document.getElementById('grid');
const countEl = document.getElementById('count');
const fCategory = document.getElementById('f-category');
const fTheme = document.getElementById('f-theme');
const fBrand = document.getElementById('f-brand');
const fSort = document.getElementById('f-sort');

let all = [];

// --- Auth guard ---
fetch('/api/auth/me')
  .then((r) => {
    if (!r.ok) throw new Error('unauth');
    return r.json();
  })
  .then((data) => {
    document.getElementById('user-email').textContent = data.user.email;
    load();
  })
  .catch(() => (window.location.href = '/login.html'));

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function load() {
  const res = await fetch('/api/history');
  if (!res.ok) return;
  const { generations } = await res.json();
  all = generations;

  // Remplit le filtre catégories (valeurs distinctes).
  const cats = [...new Set(all.map((g) => g.category).filter(Boolean))].sort();
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    fCategory.appendChild(o);
  }
  // Remplit le filtre thèmes présents.
  const themes = [...new Set(all.map((g) => g.theme).filter(Boolean))];
  for (const t of themes) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = THEME_LABELS[t] || t;
    fTheme.appendChild(o);
  }

  render();
}

function fmtDate(s) {
  // created_at stocké en UTC "YYYY-MM-DD HH:MM:SS".
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function render() {
  const cat = fCategory.value;
  const theme = fTheme.value;
  const brand = fBrand.value.trim().toLowerCase();
  const sort = fSort.value;

  let rows = all.filter((g) => {
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

  countEl.textContent = `${rows.length} génération${rows.length > 1 ? 's' : ''}`;

  if (rows.length === 0) {
    gridEl.innerHTML = '<p class="text-sm text-[#897261]">Aucun résultat.</p>';
    return;
  }

  gridEl.innerHTML = rows.map(card).join('');
}

function card(g) {
  const label = [g.brand, g.flavor].filter(Boolean).join(' · ');
  const themeLabel = THEME_LABELS[g.theme] || g.theme;
  const date = fmtDate(g.createdAt);
  if (g.status === 'done' && g.url) {
    return `
      <div class="rounded-lg border border-[#e6e0db] bg-white overflow-hidden flex flex-col">
        <img src="${g.url}" class="w-full aspect-square object-cover" loading="lazy" />
        <div class="p-2 flex flex-col gap-0.5">
          <p class="text-xs font-bold text-[#181411] truncate">${esc(label)}</p>
          <p class="text-[10px] text-[#897261] truncate">${esc(g.category)} · ${esc(themeLabel)}</p>
          <p class="text-[10px] text-[#897261]">${date}</p>
          <a href="${g.url}?download=1" download class="text-xs font-bold text-[#ec6d13] hover:underline mt-1">Télécharger</a>
        </div>
      </div>`;
  }
  const badge = g.status === 'error' ? 'Échec' : 'En cours…';
  return `
    <div class="rounded-lg border border-[#e6e0db] bg-white p-2 flex flex-col justify-between aspect-square">
      <div>
        <p class="text-xs font-bold text-[#181411] truncate">${esc(label)}</p>
        <p class="text-[10px] text-[#897261] truncate">${esc(g.category)} · ${esc(themeLabel)}</p>
      </div>
      <div>
        <p class="text-[10px] text-[#897261]">${date}</p>
        <p class="text-xs text-[#897261]">${badge}</p>
      </div>
    </div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

[fCategory, fTheme, fSort].forEach((el) => el.addEventListener('change', render));
fBrand.addEventListener('input', render);
document.getElementById('reset').addEventListener('click', () => {
  fCategory.value = '';
  fTheme.value = '';
  fBrand.value = '';
  fSort.value = 'date-desc';
  render();
});
