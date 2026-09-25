// Console d'administration. Aucune logique de droits ici : le serveur répond
// 404 si le compte n'est pas admin, et la page se contente de le dire.
import { api, ApiError } from './api.js';
import { mountChrome } from './nav.js';
import { t, tList, has, money, n as num, percent, date as fmtLocale } from './i18n.js';

const $ = (id) => document.getElementById(id);
const errorEl = $('error');
// Les coûts remontent en dollars ; on les convertit puis on laisse Intl placer
// le symbole et le séparateur décimal selon la langue active.
const euro = (usd, rate) => money((usd || 0) * rate);
const usd = (v, digits = 2) => num(v || 0, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// parseServerDate() (i18n.js) gère les deux formats qui cohabitent en base :
// SQLite ('2026-09-13 17:31:29', UTC sans fuseau) et ISO écrit par Node.
const date = (s) => fmtLocale(s, { dateStyle: 'short', timeStyle: 'short' }) || '—';

// Les valeurs de thème et d'état sont des clés techniques stockées en base :
// on les affiche traduites quand on les connaît, brutes sinon.
const themeName = (v) => (v && has(`themes.${v}`) ? t(`themes.${v}`) : v || '—');
const statusName = (v) => (v && has(`admin.gens.rowStatus.${v}`) ? t(`admin.gens.rowStatus.${v}`) : v || '—');

function fail(err) {
  errorEl.textContent = err instanceof ApiError && err.status === 404 ? t('admin.notAdmin') : (err.message || t('errors.generic'));
  errorEl.classList.remove('hidden');
}

const TH = 'text-left font-body-sm text-body-sm text-secondary font-semibold px-md py-sm';
const TD = 'px-md py-sm font-body-sm text-body-sm border-t border-outline-variant align-middle';
// 44 px minimum au doigt (tablette comprise), taille compacte sur desktop.
const BTN = 'rounded-lg border border-outline-variant px-sm py-[2px] font-body-sm text-body-sm hover:bg-surface-container inline-flex items-center justify-center min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0';

function table(headers, rows) {
  return `<table class="w-full border-collapse min-w-[640px]">
    <thead><tr>${headers.map((h) => `<th class="${TH}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('') || `<tr><td class="${TD}" colspan="${headers.length}">${esc(t('admin.noData'))}</td></tr>`}</tbody>
  </table>`;
}

function card(label, value, hint = '') {
  return `<div class="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg flex flex-col gap-[2px]">
    <span class="font-body-sm text-body-sm text-secondary">${esc(label)}</span>
    <span class="font-display-lg text-headline-md sm:text-display-lg text-on-surface">${esc(value)}</span>
    ${hint ? `<span class="font-body-sm text-body-sm text-secondary">${esc(hint)}</span>` : ''}
  </div>`;
}

async function loadOverview() {
  const d = await api.admin.overview();
  const rate = d.usdToEur || 0.92;
  $('stats').innerHTML = [
    card(t('admin.stats.generations'), num(d.gen.total ?? 0), t('admin.stats.generationsHint', { done: num(d.gen.done ?? 0), errors: num(d.gen.errors ?? 0) })),
    card(t('admin.stats.totalCost'), euro(d.gen.cost_usd, rate), usd(d.gen.cost_usd, 3)),
    card(t('admin.stats.thisMonth'), num(d.month.n ?? 0), t('admin.stats.thisMonthHint', { amount: euro(d.month.cost_usd, rate), today: num(d.today.n ?? 0) })),
    card(t('admin.stats.accounts'), num(d.users.total ?? 0), t('admin.stats.accountsHint', { verified: num(d.users.verified ?? 0), week: num(d.users.new_week ?? 0) })),
  ].join('');

  $('models').innerHTML = table(tList('admin.models.head'),
    d.models.map((m) => `<tr><td class="${TD}">${esc(m.model)}</td><td class="${TD}">${num(m.n)}</td><td class="${TD}">${esc(euro(m.cost_usd, rate))}</td></tr>`));

  const fb = d.fallback || {};
  const total = (fb.fallback || 0) + (fb.auto || 0);
  $('themes').innerHTML = table(tList('admin.themes.head'),
    d.themes.map((row) => `<tr><td class="${TD}">${esc(themeName(row.theme))}</td><td class="${TD}">${num(row.n)}</td></tr>`))
    + `<p class="font-body-sm text-body-sm text-secondary mt-md">${esc(t('admin.themes.artDirector', {
        auto: num(fb.auto || 0),
        fallback: num(fb.fallback || 0),
        rate: total ? t('admin.themes.failureRate', { pct: percent((fb.fallback || 0) / total) }) : '',
      }))}</p>`;
}

async function loadUsers() {
  const q = $('search').value.trim();
  const showDeleted = !!$('show-deleted')?.checked;
  const { users } = await api.admin.users(q, showDeleted);
  $('users').innerHTML = table(
    tList('admin.users.head'),
    users.map((u) => {
      const plan = u.unlimited ? t('admin.users.planAdmin') : u.subscription ? `${u.subscription.plan_key} (${u.subscription.status})` : 'free';
      const flags = [
        u.emailVerified ? '' : `<span title="${esc(t('admin.users.unverifiedTitle'))}" class="text-error">✉︎</span>`,
        u.locked_until ? `<span title="${esc(t('admin.users.lockedTitle'))}" class="text-error">🔒</span>` : '',
      ].join(' ');
      // Un compte désactivé n'a plus d'adresse : on affiche la date de
      // suppression et le motif, qui sont la seule information utile restante.
      const label = u.deletedAt
        ? `<span class="text-outline" title="${esc(u.deletion_reason || '')}">${esc(t('admin.users.deletedOn', { date: date(u.deletedAt) }))}</span>`
        : `${esc(u.email)} ${flags}`;
      return `<tr data-user="${u.id}"${u.deletedAt ? ' class="opacity-70"' : ''}>
        <td class="${TD}">${u.id}</td>
        <td class="${TD}">${label}</td>
        <td class="${TD}">${esc(plan)}</td>
        <td class="${TD}">${num(u.done || 0)}</td>
        <td class="${TD}">${esc(usd(u.cost_usd))}</td>
        <td class="${TD}">${num(u.extra_credits || 0)}</td>
        <td class="${TD}">${date(u.created_at)}</td>
        <td class="${TD}">${date(u.last_login_at)}</td>
        <td class="${TD}">${u.deletedAt ? `<span class="font-label-sm text-label-sm text-outline">${esc(t('admin.users.noActions'))}</span>` : `<div class="flex flex-wrap gap-sm">
          <button class="${BTN}" data-act="credits" data-n="10">+10</button>
          <button class="${BTN}" data-act="credits" data-n="-10">−10</button>
          ${u.emailVerified ? '' : `<button class="${BTN}" data-act="verify">${esc(t('admin.users.verify'))}</button>`}
          ${u.locked_until ? `<button class="${BTN}" data-act="unlock">${esc(t('admin.users.unlock'))}</button>` : ''}
          <button class="${BTN}" data-act="logout-all">${esc(t('admin.users.revoke'))}</button>
          ${u.unlimited ? '' : `<button class="${BTN} text-error" data-act="delete">${esc(t('common.delete'))}</button>`}
        </div>`}</td>
      </tr>`;
    })
  );
}

async function loadGenerations() {
  const { generations } = await api.admin.generations($('gen-status').value);
  $('generations').innerHTML = table(
    tList('admin.gens.head'),
    generations.map((g) => `<tr data-gen="${g.id}">
      <td class="${TD}">${g.id}</td>
      <td class="${TD}">${esc(g.email || '—')}</td>
      <td class="${TD}">${esc(g.brand)}</td>
      <td class="${TD}">${esc(themeName(g.theme))}</td>
      <td class="${TD}">${g.status === 'error' ? `<span class="text-error" title="${esc(g.error || '')}">${esc(t('admin.gens.failed'))}</span>` : esc(statusName(g.status))}</td>
      <td class="${TD}">${esc(g.model || '—')} ${esc(g.image_size || '')}</td>
      <td class="${TD}">${g.product_count || g.input_count || '—'}</td>
      <td class="${TD}">${esc(g.art_direction_source || '—')}</td>
      <td class="${TD}">${esc(usd(g.cost_usd, 3))}</td>
      <td class="${TD}">${esc(date(g.created_at))}</td>
      <td class="${TD}"><button class="${BTN} text-error" data-act="del-gen">${esc(t('common.delete'))}</button></td>
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
      if (!window.confirm(t('admin.users.deleteConfirm', { email }))) return;
      await api.admin.deleteUser(id);
    }
    await Promise.all([loadUsers(), loadOverview()]);
  } catch (err) { fail(err); } finally { btn.disabled = false; }
});

$('generations').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act="del-gen"]');
  if (!btn) return;
  const id = Number(btn.closest('tr').dataset.gen);
  if (!window.confirm(t('admin.gens.deleteConfirm', { id }))) return;
  try {
    btn.disabled = true;
    await api.admin.deleteGeneration(id);
    await Promise.all([loadGenerations(), loadOverview()]);
  } catch (err) { fail(err); } finally { btn.disabled = false; }
});

let searchTimer;
// Bascule « comptes désactivés » : rechargement immédiat, sans anti-rebond —
// c'est une case, pas une frappe au clavier.
$('show-deleted')?.addEventListener('change', () => loadUsers().catch(fail));

$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadUsers().catch(fail), 250);
});
$('gen-status').addEventListener('change', () => loadGenerations().catch(fail));

// Chrome commun (nav, pied de page, bandeaux) AVANT tout chargement : sans lui
// la page d'admin n'avait ni barre de navigation ni pied de page, et on ne
// pouvait plus revenir vers l'accueil ou le studio. mountChrome({requireAuth})
// remplace requireUser() : il appelle /api/auth/me (401 → /login.html) et
// renvoie l'utilisateur, ou null quand la redirection est déjà partie.
(async () => {
  const user = await mountChrome({ requireAuth: true });
  if (!user) return; // 401 : redirection vers /login.html déjà déclenchée
  try {
    await Promise.all([loadOverview(), loadUsers(), loadGenerations()]);
  } catch (err) { fail(err); }
})();
