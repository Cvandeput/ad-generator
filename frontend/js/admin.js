// Console d'administration. Aucune logique de droits ici : le serveur répond
// 404 si le compte n'est pas admin, et la page se contente de le dire.
import { api, ApiError, requireUser } from './api.js';

const $ = (id) => document.getElementById(id);
const errorEl = $('error');
const euro = (usd, rate) => (usd * rate).toFixed(2).replace('.', ',');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function fail(err) {
  errorEl.textContent = err instanceof ApiError && err.status === 404
    ? "Cette console est réservée aux administrateurs."
    : (err.message || 'Erreur');
  errorEl.classList.remove('hidden');
}

const TH = 'text-left font-body-sm text-body-sm text-secondary font-semibold px-md py-sm';
const TD = 'px-md py-sm font-body-sm text-body-sm border-t border-outline-variant align-middle';
const BTN = 'rounded-lg border border-outline-variant px-sm py-[2px] font-body-sm text-body-sm hover:bg-surface-container';

function table(headers, rows) {
  return `<table class="w-full border-collapse min-w-[640px]">
    <thead><tr>${headers.map((h) => `<th class="${TH}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('') || `<tr><td class="${TD}" colspan="${headers.length}">Aucune donnée.</td></tr>`}</tbody>
  </table>`;
}

function card(label, value, hint = '') {
  return `<div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg flex flex-col gap-[2px]">
    <span class="font-body-sm text-body-sm text-secondary">${esc(label)}</span>
    <span class="font-display-sm text-display-sm text-on-surface">${esc(value)}</span>
    ${hint ? `<span class="font-body-sm text-body-sm text-secondary">${esc(hint)}</span>` : ''}
  </div>`;
}

async function loadOverview() {
  const d = await api.admin.overview();
  const rate = d.usdToEur || 0.92;
  $('stats').innerHTML = [
    card('Générations', d.gen.total ?? 0, `${d.gen.done ?? 0} réussies · ${d.gen.errors ?? 0} en échec`),
    card('Coût total', `${euro(d.gen.cost_usd || 0, rate)} €`, `${(d.gen.cost_usd || 0).toFixed(3)} $`),
    card('Ce mois', d.month.n ?? 0, `${euro(d.month.cost_usd || 0, rate)} € · aujourd'hui ${d.today.n ?? 0}`),
    card('Comptes', d.users.total ?? 0, `${d.users.verified ?? 0} vérifiés · ${d.users.new_week ?? 0} cette semaine`),
  ].join('');

  $('models').innerHTML = table(['Modèle', 'Générations', 'Coût'],
    d.models.map((m) => `<tr><td class="${TD}">${esc(m.model)}</td><td class="${TD}">${m.n}</td><td class="${TD}">${euro(m.cost_usd || 0, rate)} €</td></tr>`));

  const fb = d.fallback || {};
  const total = (fb.fallback || 0) + (fb.auto || 0);
  $('themes').innerHTML = table(['Thème', 'Générations'],
    d.themes.map((t) => `<tr><td class="${TD}">${esc(t.theme)}</td><td class="${TD}">${t.n}</td></tr>`))
    + `<p class="font-body-sm text-body-sm text-secondary mt-md">Directeur artistique : ${fb.auto || 0} scènes composées, ${fb.fallback || 0} replis${total ? ` (${Math.round(((fb.fallback || 0) / total) * 100)} % d'échec du node texte)` : ''}.</p>`;
}

async function loadUsers() {
  const q = $('search').value.trim();
  const { users } = await api.admin.users(q);
  $('users').innerHTML = table(
    ['#', 'E-mail', 'Formule', 'Réussies', 'Coût', 'Crédits', 'Inscription', 'Dernière connexion', 'Actions'],
    users.map((u) => {
      const plan = u.unlimited ? 'admin (illimité)' : u.subscription ? `${u.subscription.plan_key} (${u.subscription.status})` : 'free';
      const flags = [
        u.emailVerified ? '' : '<span title="Adresse non confirmée" class="text-error">✉︎</span>',
        u.locked_until ? '<span title="Compte verrouillé" class="text-error">🔒</span>' : '',
      ].join(' ');
      return `<tr data-user="${u.id}">
        <td class="${TD}">${u.id}</td>
        <td class="${TD}">${esc(u.email)} ${flags}</td>
        <td class="${TD}">${esc(plan)}</td>
        <td class="${TD}">${u.done || 0}</td>
        <td class="${TD}">${(u.cost_usd || 0).toFixed(2)} $</td>
        <td class="${TD}">${u.extra_credits || 0}</td>
        <td class="${TD}">${date(u.created_at)}</td>
        <td class="${TD}">${date(u.last_login_at)}</td>
        <td class="${TD}"><div class="flex flex-wrap gap-sm">
          <button class="${BTN}" data-act="credits" data-n="10">+10</button>
          <button class="${BTN}" data-act="credits" data-n="-10">−10</button>
          ${u.emailVerified ? '' : `<button class="${BTN}" data-act="verify">Vérifier</button>`}
          ${u.locked_until ? `<button class="${BTN}" data-act="unlock">Déverrouiller</button>` : ''}
          <button class="${BTN}" data-act="logout-all">Révoquer sessions</button>
          ${u.unlimited ? '' : `<button class="${BTN} text-error" data-act="delete">Supprimer</button>`}
        </div></td>
      </tr>`;
    })
  );
}

async function loadGenerations() {
  const { generations } = await api.admin.generations($('gen-status').value);
  $('generations').innerHTML = table(
    ['#', 'Compte', 'Marque', 'Thème', 'État', 'Modèle', 'Produits', 'DA', 'Coût', 'Date', ''],
    generations.map((g) => `<tr data-gen="${g.id}">
      <td class="${TD}">${g.id}</td>
      <td class="${TD}">${esc(g.email || '—')}</td>
      <td class="${TD}">${esc(g.brand)}</td>
      <td class="${TD}">${esc(g.theme)}</td>
      <td class="${TD}">${g.status === 'error' ? `<span class="text-error" title="${esc(g.error || '')}">échec</span>` : esc(g.status)}</td>
      <td class="${TD}">${esc(g.model || '—')} ${esc(g.image_size || '')}</td>
      <td class="${TD}">${g.product_count || g.input_count || '—'}</td>
      <td class="${TD}">${esc(g.art_direction_source || '—')}</td>
      <td class="${TD}">${(g.cost_usd || 0).toFixed(3)} $</td>
      <td class="${TD}">${date(g.created_at)}</td>
      <td class="${TD}"><button class="${BTN} text-error" data-act="del-gen">Supprimer</button></td>
    </tr>`)
  );
}

// Actions sur les comptes (délégation : le tableau est réécrit à chaque fois).
$('users').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('tr').dataset.user);
  const act = btn.dataset.act;
  try {
    btn.disabled = true;
    if (act === 'credits') await api.admin.credits(id, Number(btn.dataset.n));
    else if (act === 'verify') await api.admin.verifyUser(id);
    else if (act === 'unlock') await api.admin.unlock(id);
    else if (act === 'logout-all') await api.admin.logoutAll(id);
    else if (act === 'delete') {
      const email = btn.closest('tr').children[1].textContent.trim();
      if (!window.confirm(`Supprimer définitivement ${email} ? Le compte, son historique et ses fichiers sont effacés. Irréversible.`)) return;
      await api.admin.deleteUser(id);
    }
    await Promise.all([loadUsers(), loadOverview()]);
  } catch (err) { fail(err); } finally { btn.disabled = false; }
});

$('generations').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="del-gen"]');
  if (!btn) return;
  const id = Number(btn.closest('tr').dataset.gen);
  if (!window.confirm(`Supprimer la génération #${id} et ses fichiers ?`)) return;
  try {
    btn.disabled = true;
    await api.admin.deleteGeneration(id);
    await Promise.all([loadGenerations(), loadOverview()]);
  } catch (err) { fail(err); } finally { btn.disabled = false; }
});

let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadUsers().catch(fail), 250);
});
$('gen-status').addEventListener('change', () => loadGenerations().catch(fail));

(async () => {
  await requireUser(); // 401 → /login.html
  try {
    await Promise.all([loadOverview(), loadUsers(), loadGenerations()]);
  } catch (err) { fail(err); }
})();
