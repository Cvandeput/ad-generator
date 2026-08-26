// Dashboard : upload multi-images, formulaire produit, thème, génération, historique.

const MAX_IMAGES = 14;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const previews = document.getElementById('previews');
const themesEl = document.getElementById('themes');
const generateBtn = document.getElementById('generate');
const genError = document.getElementById('gen-error');
const resultSection = document.getElementById('result-section');
const resultBody = document.getElementById('result-body');
const historyEl = document.getElementById('history');

let files = []; // File[]
let selectedTheme = null;

// --- Garde d'authentification ---
fetch('/api/auth/me')
  .then((r) => {
    if (!r.ok) throw new Error('unauth');
    return r.json();
  })
  .then((data) => {
    document.getElementById('user-email').textContent = data.user.email;
    loadHistory();
    loadUsage();
  })
  .catch(() => (window.location.href = '/login.html'));

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// --- Dropzone ---
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('border-[#ec6d13]');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-[#ec6d13]'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('border-[#ec6d13]');
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => addFiles(fileInput.files));

function addFiles(fileList) {
  for (const f of fileList) {
    if (!ALLOWED.includes(f.type)) continue;
    if (files.length >= MAX_IMAGES) break;
    files.push(f);
  }
  fileInput.value = '';
  renderPreviews();
}

function renderPreviews() {
  previews.innerHTML = '';
  files.forEach((f, i) => {
    const url = URL.createObjectURL(f);
    const cell = document.createElement('div');
    cell.className = 'relative aspect-square rounded-lg overflow-hidden border border-[#e6e0db]';
    cell.innerHTML = `
      <img src="${url}" class="w-full h-full object-cover" />
      <button data-i="${i}" class="remove absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs">✕</button>`;
    previews.appendChild(cell);
  });
  previews.querySelectorAll('.remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      files.splice(Number(btn.dataset.i), 1);
      renderPreviews();
    })
  );
}

// --- Thèmes ---
themesEl.querySelectorAll('.theme-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    selectedTheme = btn.dataset.theme;
    themesEl.querySelectorAll('.theme-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('bg-[#ec6d13]', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('border-[#ec6d13]', active);
      b.classList.toggle('text-[#181411]', !active);
    });
  })
);

// --- Génération ---
generateBtn.addEventListener('click', async () => {
  genError.classList.add('hidden');
  const brand = document.getElementById('brand').value.trim();
  const category = document.getElementById('category').value.trim();
  const flavor = document.getElementById('flavor').value.trim();

  if (files.length === 0) return showError('Ajoutez au moins une image.');
  if (!brand) return showError('Renseignez la marque.');
  if (!category) return showError('Renseignez la catégorie.');
  if (!selectedTheme) return showError('Choisissez un thème.');

  const fd = new FormData();
  fd.append('brand', brand);
  fd.append('category', category);
  fd.append('flavor', flavor);
  fd.append('theme', selectedTheme);
  files.forEach((f) => fd.append('images', f));

  setLoading(true);
  try {
    const res = await fetch('/api/generate', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Échec de la génération');
    showResult(data.url);
    loadHistory();
    loadUsage();
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

function setLoading(on) {
  generateBtn.disabled = on;
  generateBtn.textContent = on ? 'Génération en cours… (jusqu\'à ~1 min)' : 'Générer la publicité';
}

function showError(msg) {
  genError.textContent = msg;
  genError.classList.remove('hidden');
}

function showResult(url) {
  resultSection.classList.remove('hidden');
  resultBody.innerHTML = `
    <img src="${url}" class="max-h-96 rounded-lg border border-[#e6e0db]" />
    <a href="${url}?download=1" download
       class="h-11 px-6 flex items-center rounded-lg bg-[#ec6d13] text-white font-bold hover:bg-[#d5610f]">
       Télécharger
    </a>`;
  resultSection.scrollIntoView({ behavior: 'smooth' });
}

// --- Historique ---
async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) return;
    const { generations } = await res.json();
    if (generations.length === 0) {
      historyEl.innerHTML = '<p class="text-sm text-[#897261]">Aucune génération pour l\'instant.</p>';
      return;
    }
    historyEl.innerHTML = generations
      .map((g) => {
        const label = [g.brand, g.flavor].filter(Boolean).join(' · ');
        if (g.status === 'done' && g.url) {
          return `
            <div class="rounded-lg border border-[#e6e0db] overflow-hidden">
              <img src="${g.url}" class="w-full aspect-square object-cover" />
              <div class="p-2">
                <p class="text-xs font-bold text-[#181411] truncate">${escapeHtml(label)}</p>
                <p class="text-[10px] text-[#897261]">${g.theme}</p>
                <a href="${g.url}?download=1" download class="text-xs font-bold text-[#ec6d13] hover:underline">Télécharger</a>
              </div>
            </div>`;
        }
        const badge = g.status === 'error' ? 'Échec' : 'En cours…';
        return `
          <div class="rounded-lg border border-[#e6e0db] p-2 flex flex-col justify-between aspect-square">
            <p class="text-xs font-bold text-[#181411] truncate">${escapeHtml(label)}</p>
            <p class="text-xs text-[#897261]">${badge}</p>
          </div>`;
      })
      .join('');
  } catch {
    /* silencieux */
  }
}

async function loadUsage() {
  try {
    const res = await fetch('/api/usage');
    if (!res.ok) return;
    const u = await res.json();
    document.getElementById('usage-month').textContent =
      `${u.currentMonth.count} images · ≈ ${u.currentMonth.eur.toFixed(2)} € ($${u.currentMonth.usd.toFixed(2)})`;
    document.getElementById('usage-all').textContent =
      `${u.allTime.count} images · ≈ ${u.allTime.eur.toFixed(2)} €`;
  } catch {
    /* silencieux */
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
