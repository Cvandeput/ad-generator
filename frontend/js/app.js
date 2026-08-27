// Dashboard studio : upload multi-images, contexte produit, thème, génération.
import { api, requireUser } from './api.js';
import { renderThemeButtons, escapeHtml, IMG_FALLBACK_ATTRS, brokenThumb, usageLabel } from './components.js';

const MAX_IMAGES = 14;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const previews = document.getElementById('previews');
const themesEl = document.getElementById('themes');
const generateBtn = document.getElementById('generate');
const genLabel = generateBtn.querySelector('.js-generate-label');
const resultBody = document.getElementById('result-body');

let files = []; // File[]
let selectedTheme = null;

// --- Garde d'authentification ---
requireUser()
  .then((user) => {
    document.getElementById('user-email').textContent = user.email;
    document.getElementById('logout').title = `Déconnexion (${user.email})`;
    loadUsage();
  })
  .catch(() => {}); // 401 → redirigé par api.js

document.getElementById('logout').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  window.location.href = '/login.html';
});

// --- Thèmes (injectés depuis la source unique) ---
themesEl.innerHTML = renderThemeButtons();
themesEl.querySelectorAll('.theme-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    selectedTheme = btn.dataset.theme;
    themesEl.querySelectorAll('.theme-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('border-2', active);
      b.classList.toggle('border-primary-container', active);
      b.classList.toggle('border-outline-variant', !active);
      b.classList.toggle('bg-primary-fixed', active);
      b.classList.toggle('bg-surface-container-lowest', !active);
      b.querySelector('.theme-check').classList.toggle('hidden', !active);
      const label = b.querySelector('.theme-label');
      label.classList.toggle('text-primary-container', active);
      label.classList.toggle('font-bold', active);
      label.classList.toggle('text-on-surface', !active);
    });
  })
);

// --- Dropzone ---
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
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
    cell.className =
      'relative w-16 h-16 rounded border border-outline-variant bg-surface-container-lowest group overflow-hidden flex-shrink-0';
    cell.innerHTML = `
      <img src="${url}" class="w-full h-full object-contain p-sm" />
      <button data-i="${i}" class="remove absolute top-1 right-1 w-5 h-5 bg-surface-container-lowest rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-outline-variant text-error" aria-label="Retirer">
        <span class="material-symbols-outlined text-[12px]">close</span>
      </button>`;
    previews.appendChild(cell);
  });
  previews.querySelectorAll('.remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      files.splice(Number(btn.dataset.i), 1);
      renderPreviews();
    })
  );
}

// --- Génération ---
let abortController = null;

generateBtn.addEventListener('click', async () => {
  const brand = document.getElementById('brand').value.trim();
  const category = document.getElementById('category').value.trim();
  const flavor = document.getElementById('flavor').value.trim();

  if (files.length === 0) return showError('Ajoutez au moins une image.');
  if (!brand) return showError('Renseignez la marque.');
  if (!category) return showError('Choisissez une catégorie.');
  if (!selectedTheme) return showError('Choisissez un thème.');

  const fd = new FormData();
  fd.append('brand', brand);
  fd.append('category', category);
  fd.append('flavor', flavor);
  fd.append('theme', selectedTheme);
  files.forEach((f) => fd.append('images', f));

  setLoading(true);
  abortController = new AbortController();
  const progress = startProgress(() => abortController.abort());
  try {
    const data = await api.generate(fd, { signal: abortController.signal });
    progress.finish();
    showResult(data.url);
    loadUsage();
  } catch (err) {
    progress.stop();
    // Annulation utilisateur : retour à l'état vide, pas un message d'erreur.
    if (abortController.signal.aborted) showEmpty();
    else showError(err.message || 'Échec de la génération');
  } finally {
    abortController = null;
    setLoading(false);
  }
});

function setLoading(on) {
  generateBtn.disabled = on;
  if (genLabel) genLabel.textContent = on ? 'Génération…' : 'Générer';
}

// Une étape de l'attente longue (rendue puis pilotée par setStep dans le timer).
function stepRow(n, label) {
  return `
    <li class="js-step flex items-center gap-sm" data-step="${n}">
      <span class="js-step-dot w-6 h-6 rounded-full border border-outline-variant flex items-center justify-center text-secondary font-label-sm text-label-sm shrink-0">${n}</span>
      <span class="js-step-label font-body-sm text-body-sm text-secondary">${escapeHtml(label)}</span>
    </li>`;
}

// État "attente longue" : trois étapes nommées + progression par le temps (l'appel
// n8n dure jusqu'à ~120 s sans retour intermédiaire) + annulation. `onCancel` est
// déclenché par le bouton Annuler (abort côté client ; n8n peut finir côté serveur).
function startProgress(onCancel) {
  resultBody.innerHTML = `
    <div class="w-full max-w-[400px] flex flex-col gap-lg bg-surface-container-lowest border border-outline-variant rounded-lg p-lg">
      <div class="flex flex-col gap-xs text-center">
        <span class="font-headline-md text-headline-md text-on-surface">Génération en cours…</span>
        <span class="font-body-sm text-body-sm text-secondary">Cela peut prendre jusqu'à ~2 minutes. Gardez la page ouverte.</span>
      </div>
      <ol class="flex flex-col gap-sm">
        ${stepRow(1, 'Envoi des images')}
        ${stepRow(2, 'Composition du visuel (Gemini)')}
        ${stepRow(3, 'Rendu haute définition')}
      </ol>
      <div class="flex flex-col gap-xs">
        <div class="progress-track"><div id="prog-bar" class="progress-bar" style="width:3%"></div></div>
        <span id="prog-pct" class="font-label-sm text-label-sm text-secondary text-right">3 %</span>
      </div>
      <button id="cancel-gen" type="button"
        class="self-center px-lg py-sm bg-surface-container-lowest border border-outline-variant rounded text-on-surface font-label-md text-label-md hover:bg-surface-container transition-colors">
        Annuler
      </button>
    </div>`;

  const bar = document.getElementById('prog-bar');
  const pctEl = document.getElementById('prog-pct');
  const steps = [...resultBody.querySelectorAll('.js-step')];
  document.getElementById('cancel-gen').addEventListener('click', () => onCancel?.());

  // cur = étape en cours (4 = tout terminé). < cur : fait (coche), = cur : actif.
  function setStep(cur) {
    for (const li of steps) {
      const n = Number(li.dataset.step);
      const dot = li.querySelector('.js-step-dot');
      const lbl = li.querySelector('.js-step-label');
      const done = n < cur;
      const active = n === cur;
      dot.classList.toggle('bg-primary', done);
      dot.classList.toggle('bg-primary-container', active);
      dot.classList.toggle('text-on-primary', done || active);
      dot.classList.toggle('border-primary-container', done || active);
      dot.classList.toggle('text-secondary', !done && !active);
      dot.classList.toggle('border-outline-variant', !done && !active);
      dot.innerHTML = done ? '<span class="material-symbols-outlined text-[14px]">check</span>' : String(n);
      lbl.classList.toggle('text-on-surface', done || active);
      lbl.classList.toggle('text-secondary', !done && !active);
      lbl.classList.toggle('font-bold', active);
    }
  }
  setStep(1);

  const start = Date.now();
  const target = 115000; // ~2 min : on approche 95 % puis on attend la réponse
  const timer = setInterval(() => {
    const t = Date.now() - start;
    const pct = Math.min(95, (t / target) * 95);
    if (bar) bar.style.width = `${pct.toFixed(1)}%`;
    if (pctEl) pctEl.textContent = `${Math.round(pct)} %`;
    setStep(t > 45000 ? 3 : t > 4000 ? 2 : 1);
  }, 500);

  return {
    finish() {
      clearInterval(timer);
      if (bar) bar.style.width = '100%';
      if (pctEl) pctEl.textContent = '100 %';
      setStep(4);
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function showResult(url) {
  resultBody.innerHTML = `
    <div class="flex flex-col items-center gap-md">
      <div class="relative w-full max-w-[400px] aspect-[4/5] bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
        <img src="${url}" class="w-full h-full object-cover" alt="Visuel généré" ${IMG_FALLBACK_ATTRS} />
        ${brokenThumb()}
      </div>
      <a href="${url}?download=1" download
         class="bg-primary-container text-on-primary font-label-md text-label-md px-lg py-sm rounded hover:bg-primary transition-colors flex items-center gap-xs">
        <span class="material-symbols-outlined text-[16px]">download</span> Télécharger
      </a>
    </div>`;
}

// État vide (défaut + après annulation) : même carte centrée que app.html.
function showEmpty() {
  resultBody.innerHTML = `
    <div class="flex flex-col items-center gap-md opacity-60">
      <span class="material-symbols-outlined text-[48px] text-outline-variant">auto_awesome</span>
      <div class="flex flex-col gap-xs">
        <span class="font-headline-md text-headline-md text-on-surface">Toile de création</span>
        <span class="font-body-sm text-body-sm text-secondary">Configurez vos paramètres puis cliquez sur « Générer » pour visualiser le résultat.</span>
      </div>
    </div>`;
}

function showError(msg) {
  resultBody.innerHTML = `
    <div class="flex flex-col items-center gap-md max-w-sm">
      <div class="w-16 h-16 rounded-full bg-error-container flex items-center justify-center">
        <span class="material-symbols-outlined text-[32px] text-error">error</span>
      </div>
      <div class="flex flex-col gap-xs">
        <span class="font-headline-md text-headline-md text-on-surface">Échec de la génération</span>
        <span class="font-body-sm text-body-sm text-secondary">${escapeHtml(msg)}</span>
      </div>
    </div>`;
}

async function loadUsage() {
  try {
    document.getElementById('usage-header').textContent = usageLabel(await api.usage());
  } catch {
    /* silencieux */
  }
}
