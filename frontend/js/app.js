// Dashboard studio : upload multi-images, contexte produit, thème, génération.
import { api } from './api.js';
import { renderThemeButtons, escapeHtml, IMG_FALLBACK_ATTRS, brokenThumb, wireImageFallbacks } from './components.js';
import { mountChrome, refreshUsage } from './nav.js';

const MAX_IMAGES = 14;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const previews = document.getElementById('previews');
const photoCount = document.getElementById('photo-count');
const themesEl = document.getElementById('themes');
const generateBtn = document.getElementById('generate');
const genLabel = generateBtn.querySelector('.js-generate-label');
const resultBody = document.getElementById('result-body');

let files = []; // File[]
let selectedTheme = null;

// --- Chrome commun (nav, footer, cookies, CGU) + garde d'authentification ---
wireImageFallbacks();
mountChrome({ requireAuth: true }).then((user) => {
  if (user) loadUsage();
});

// --- Thèmes (injectés depuis la source unique) ---
themesEl.innerHTML = renderThemeButtons();
themesEl.querySelectorAll('.theme-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    selectedTheme = btn.dataset.theme;
    themesEl.querySelectorAll('.theme-btn').forEach((b) => {
      const active = b === btn;
      // Bordure accent 2px sur l'aperçu + pastille cochée (cf. renderThemeButtons).
      const preview = b.querySelector('.theme-preview');
      preview.classList.toggle('border-2', active);
      preview.classList.toggle('border-primary-container', active);
      preview.classList.toggle('border', !active);
      preview.classList.toggle('border-outline-variant', !active);
      const check = b.querySelector('.theme-check');
      check.classList.toggle('hidden', !active);
      check.classList.toggle('flex', active);
      const label = b.querySelector('.theme-label');
      label.classList.toggle('text-on-surface', active);
      label.classList.toggle('font-bold', active);
      label.classList.toggle('text-on-surface-variant', !active);
    });
  })
);

// --- Compteur de description (discret : n'apparaît qu'au-delà de 90/120) ---
const descInput = document.getElementById('description');
const descCount = document.getElementById('desc-count');
descInput.addEventListener('input', () => {
  const len = descInput.value.length;
  descCount.textContent = `${len}/120`;
  descCount.classList.toggle('hidden', len <= 90);
});

// --- Compteur de direction artistique (n'apparaît qu'au-delà de 160/200) ---
const artInput = document.getElementById('art-direction');
const artCount = document.getElementById('art-count');
artInput.addEventListener('input', () => {
  const len = artInput.value.length;
  artCount.textContent = `${len}/200`;
  artCount.classList.toggle('hidden', len <= 160);
});

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
    cell.className = 'group relative w-16 h-20 flex-shrink-0 rounded border border-outline-variant bg-surface-container-low overflow-hidden';
    // Vignette 64×80 (maquette) ; clic = ouverture pleine taille (vérifier la
    // bonne photo). Bouton retirer au survol.
    cell.innerHTML = `
      <a href="${url}" target="_blank" rel="noopener" title="Ouvrir « ${escapeHtml(f.name)} » en grand" class="block w-full h-full">
        <img src="${url}" class="w-full h-full object-cover" alt="${escapeHtml(f.name)}" />
      </a>
      <button data-i="${i}" class="remove absolute top-0.5 right-0.5 w-4 h-4 bg-surface-container-lowest rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-outline-variant text-error z-10" aria-label="Retirer">
        <span class="material-symbols-outlined text-[11px]">close</span>
      </button>`;
    previews.appendChild(cell);
  });
  previews.querySelectorAll('.remove').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      files.splice(Number(btn.dataset.i), 1);
      renderPreviews();
    })
  );
  if (photoCount) photoCount.textContent = `${files.length} / ${MAX_IMAGES}`;
}

// --- Génération ---
let abortController = null;

generateBtn.addEventListener('click', async () => {
  const brand = document.getElementById('brand').value.trim();
  const category = document.getElementById('category').value.trim();
  const flavor = document.getElementById('flavor').value.trim();
  const description = document.getElementById('description').value.trim();
  const artDirection = document.getElementById('art-direction').value.trim();
  const productCount = document.getElementById('product-count').value.trim();

  if (files.length === 0) return showError('Ajoutez au moins une image.');
  if (!brand) return showError('Renseignez la marque.');
  if (!category) return showError('Choisissez une catégorie.');
  if (!selectedTheme) return showError('Choisissez un thème.');

  const fd = new FormData();
  fd.append('brand', brand);
  fd.append('category', category);
  fd.append('flavor', flavor);
  fd.append('description', description);
  fd.append('art_direction', artDirection);
  fd.append('theme', selectedTheme);
  if (productCount) fd.append('product_count', productCount);
  files.forEach((f) => fd.append('images', f));

  setLoading(true);
  abortController = new AbortController();
  const progress = startProgress(() => abortController.abort());
  try {
    const data = await api.generate(fd, { signal: abortController.signal });
    progress.finish();
    showResult(data);
    loadUsage();
  } catch (err) {
    progress.stop();
    // Annulation utilisateur : retour à l'état vide, pas un message d'erreur.
    if (abortController.signal.aborted) showEmpty();
    else if (err.status === 403 && err.data?.code === 'EMAIL_NOT_VERIFIED') showUnverified(err);
    else if (err.status === 402) showQuota(err);
    else showError(err.message || 'Échec de la génération');
  } finally {
    abortController = null;
    setLoading(false);
  }
});

function setLoading(on) {
  generateBtn.disabled = on;
  if (genLabel) genLabel.textContent = on ? 'Génération…' : 'Générer le visuel';
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

function showResult(data) {
  const url = data.url;
  const cost = typeof data.costEur === 'number' ? `${data.costEur.toFixed(3).replace('.', ',')} €` : '';
  resultBody.innerHTML = `
    <div class="flex flex-col items-center gap-md">
      <div class="relative w-full max-w-[420px] aspect-[4/5] bg-surface-container-low rounded overflow-hidden shadow-[0_1px_2px_rgba(26,28,28,0.06),0_12px_32px_rgba(26,28,28,0.10)]">
        <img src="${url}" class="w-full h-full object-cover" alt="Visuel généré" ${IMG_FALLBACK_ATTRS} />
        ${brokenThumb()}
        <div class="absolute top-sm left-sm flex items-center gap-xs bg-surface-container-lowest border border-outline-variant rounded-full pl-sm pr-md py-xs">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
          <span class="font-label-sm text-label-sm font-semibold text-on-surface-variant">Décor composé par l'IA${cost ? ` · ${cost}` : ''}</span>
        </div>
      </div>
      <div class="flex items-center gap-sm">
        <button type="button" id="js-rerun" class="h-8 px-md border border-outline-variant rounded bg-surface-container-lowest flex items-center gap-xs text-on-surface-variant hover:bg-surface-container transition-colors">
          <span class="material-symbols-outlined text-[15px]">refresh</span>
          <span class="font-label-md text-label-md">Relancer</span>
        </button>
        <a href="${url}?download=1" download
           class="h-8 px-md rounded bg-primary-container text-on-primary flex items-center gap-xs hover:bg-primary transition-colors">
          <span class="material-symbols-outlined text-[15px]">download</span>
          <span class="font-label-md text-label-md">Télécharger</span>
        </a>
      </div>
    </div>`;
  const rerun = document.getElementById('js-rerun');
  if (rerun) rerun.addEventListener('click', () => generateBtn.click());
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

// Adresse non confirmée : on propose le renvoi sur place plutôt qu'un message sec.
function showUnverified(err) {
  resultBody.innerHTML = `
    <div class="flex flex-col items-center gap-md max-w-sm">
      <div class="w-16 h-16 rounded-full bg-error-container flex items-center justify-center">
        <span class="material-symbols-outlined text-[32px] text-on-error-container">mark_email_unread</span>
      </div>
      <div class="flex flex-col gap-xs">
        <span class="font-headline-md text-headline-md text-on-surface">Confirmez votre adresse</span>
        <span class="font-body-sm text-body-sm text-secondary">${escapeHtml(err.message)}</span>
      </div>
      <button type="button" id="js-resend" class="h-9 px-lg rounded bg-primary-container text-on-primary flex items-center font-label-md text-label-md hover:bg-primary transition-colors">Renvoyer l'e-mail</button>
    </div>`;
  document.getElementById('js-resend')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Envoi…';
    try {
      await api.resendVerification();
      btn.textContent = 'E-mail envoyé';
    } catch {
      btn.disabled = false;
      btn.textContent = "Renvoyer l'e-mail";
    }
  });
}

// Quota d'abonnement épuisé : ce n'est pas une panne, on oriente vers les formules.
function showQuota(err) {
  const d = err.data || {};
  resultBody.innerHTML = `
    <div class="flex flex-col items-center gap-md max-w-sm">
      <div class="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center">
        <span class="material-symbols-outlined text-[32px] text-secondary">lock_clock</span>
      </div>
      <div class="flex flex-col gap-xs">
        <span class="font-headline-md text-headline-md text-on-surface">Quota atteint</span>
        <span class="font-body-sm text-body-sm text-secondary">${escapeHtml(err.message)}</span>
      </div>
      <a href="/tarifs.html" class="h-9 px-lg rounded bg-primary-container text-on-primary flex items-center font-label-md text-label-md hover:bg-primary transition-colors">Voir les formules</a>
    </div>`;
  if (d.quota) loadUsage();
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

// Coût unitaire réel (grille tarifaire du modèle configuré) + conso du mois.
async function loadUsage() {
  const u = await refreshUsage();
  const el = document.getElementById('unit-cost');
  if (!u || !el) return;
  const eur = u.unit.eur.toFixed(3).replace('.', ',');
  const size = u.unit.imageSize ? ` ${u.unit.imageSize}` : '';
  el.textContent = `≈ ${eur} € par visuel (${u.unit.model}${size}) · ${u.quota.perHour}/h, ${u.quota.perDay}/jour · 30 à 120 s`;
}
