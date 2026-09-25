// Internationalisation du front : dictionnaires JSON + hydratation du DOM par
// attributs data-i18n. Trois langues : fr (référence), en, nl.
//
// Ce module utilise un `await` de plus haut niveau : tout module qui l'importe
// attend automatiquement la fin du chargement du dictionnaire avant de
// s'exécuter. Les gabarits en template literals peuvent donc appeler t()
// directement, sans garde ni promesse à propager.
//
//   import { t, money, date } from './i18n.js';
//   `<h1>${t('home.hero.title')}</h1>`
//
// Conventions (détaillées dans docs/I18N.md) :
//   - clés en notation pointée, namespace = page ou composant ;
//   - interpolation {{var}} ; {{brand}} est injecté automatiquement ;
//   - pluriels : clés `cle_one` / `cle_other`, choisies par Intl.PluralRules
//     dès que `count` est passé en variable ;
//   - suffixe `_html` = la valeur contient du HTML volontaire (<strong>, <a>)
//     et sera injectée telle quelle ; toutes les autres valeurs sont du texte
//     et doivent passer par textContent ou par un contexte déjà échappé.

// ---------------------------------------------------------------------------
// Nom du produit, pour tous les TEXTES DU FRONT. Il n'apparaît ni dans les
// dictionnaires ni dans le HTML, où il est toujours interpolé via {{brand}}.
// Renommer le service demande aussi de toucher au backend (e-mails,
// expéditeur), au manifeste et au logo : liste dans docs/I18N.md § 5.
export const BRAND = 'AdCraft';
// ---------------------------------------------------------------------------

export const DEFAULT_LANG = 'fr';

// tag  : locale BCP-47 passée à Intl (formats de nombre, monnaie, date)
// html : valeur de <html lang> et des liens hreflang
// og   : valeur de og:locale
// label: libellé du sélecteur, DANS SA PROPRE LANGUE (jamais traduit)
// en-GB et non en : site belge, dates au format européen (13/09/2026 et non
// 9/13/26). Les prix restent identiques (€9.90) dans les deux variantes.
export const LOCALES = {
  fr: { tag: 'fr-BE', html: 'fr', og: 'fr_BE', label: 'Français' },
  en: { tag: 'en-GB', html: 'en', og: 'en_US', label: 'English' },
  nl: { tag: 'nl-BE', html: 'nl', og: 'nl_BE', label: 'Nederlands' },
};

export const LANGS = Object.keys(LOCALES);

const STORE_KEY = 'app.lang.v1'; // volontairement sans nom de marque

let lang = DEFAULT_LANG;
let dict = {};
let base = {}; // français : filet de secours pour toute clé manquante
let loaded = false; // au moins un dictionnaire chargé : l'hydratation est sûre

// --- Détection --------------------------------------------------------------
// Priorité : ?lang= dans l'URL → localStorage → navigator.language → fr.
// L'écriture dans localStorage a lieu sur choix explicite (setLang) ET à
// l'arrivée par un lien ?lang= (voir ci-dessous) — jamais sur simple détection
// de navigator.language.
function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && LOCALES[q.toLowerCase()]) {
      const code = q.toLowerCase();
      // On mémorise tout de suite : sans ça, la langue est perdue à la
      // première navigation interne. Les redirections en dur du code
      // (auth.js → /app.html, register.js → /tarifs.html…) et tous les
      // <a href="/..."> ne portent pas ?lang=, donc au clic suivant on
      // retomberait sur navigator.language. Un visiteur arrivant sur un
      // lien ?lang=nl verrait le site repasser en français ou en anglais
      // dès le premier clic. Persister ici rend le choix collant, ce qui
      // est aussi le comportement attendu d'un lien partagé.
      try { localStorage.setItem(STORE_KEY, code); } catch { /* ignore */ }
      return code;
    }
  } catch { /* URL exotique */ }
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && LOCALES[saved]) return saved;
  } catch { /* stockage indisponible (navigation privée, cookies bloqués) */ }
  const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
  for (const p of prefs) {
    const short = String(p || '').toLowerCase().split('-')[0];
    if (LOCALES[short]) return short;
  }
  return DEFAULT_LANG;
}

export function currentLang() {
  return lang;
}
export function localeTag() {
  return LOCALES[lang].tag;
}

// Change de langue sur choix explicite de l'utilisateur : on mémorise, on
// aligne l'URL (cohérence avec les hreflang) et on recharge — les gabarits JS
// (cartes de formules, lignes d'historique, bandeaux) sont ainsi régénérés
// dans la nouvelle langue sans code de re-rendu à maintenir page par page.
export function setLang(code) {
  if (!LOCALES[code]) return;
  try {
    localStorage.setItem(STORE_KEY, code);
  } catch { /* ignore */ }
  const url = new URL(location.href);
  if (code === DEFAULT_LANG) url.searchParams.delete('lang');
  else url.searchParams.set('lang', code);
  location.replace(url.toString());
}

// --- Chargement -------------------------------------------------------------
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    // Les tableaux restent des tableaux (listes d'avantages, règles de mot de
    // passe…) : ils sont lus par tList().
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

async function fetchDict(code) {
  // no-cache : revalidation systématique (requête conditionnelle, 304 si rien
  // n'a changé). nginx n'a pas de règle de cache pour le JSON : sans cela, le
  // navigateur pourrait resservir un dictionnaire périmé après un déploiement.
  const res = await fetch(`/locales/${code}.json`, { credentials: 'same-origin', cache: 'no-cache' });
  if (!res.ok) throw new Error(`locales/${code}.json: HTTP ${res.status}`);
  return flatten(await res.json());
}

// --- Lecture ----------------------------------------------------------------
const warned = new Set();
function warn(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[i18n] ${msg}`);
}

let pluralRules = null;
function plural(count) {
  if (!pluralRules) pluralRules = new Intl.PluralRules(localeTag());
  return pluralRules.select(Number(count));
}

function lookup(key) {
  if (key in dict) return dict[key];
  if (key in base) {
    warn(`clé absente de « ${lang} », repli sur le français : ${key}`);
    return base[key];
  }
  return undefined;
}

function interpolate(str, vars) {
  const all = { brand: BRAND, ...(vars || {}) };
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name) => {
    if (all[name] === undefined || all[name] === null) {
      warn(`variable « ${name} » non fournie dans : ${str}`);
      return '';
    }
    return String(all[name]);
  });
}

// Résout la clé effective : `cle_one` / `cle_other` quand `count` est fourni.
function resolveKey(key, vars) {
  if (!vars || vars.count === undefined || vars.count === null) return key;
  const cat = `${key}_${plural(vars.count)}`;
  if (cat in dict || cat in base) return cat;
  const other = `${key}_other`;
  if (other in dict || other in base) return other;
  return key;
}

// Traduction d'une chaîne. Ne renvoie JAMAIS la clé brute : une clé inconnue
// donne une chaîne vide et un avertissement en console (un libellé manquant se
// remarque à la relecture, une clé technique affichée à l'utilisateur non).
export function t(key, vars) {
  const value = lookup(resolveKey(key, vars));
  if (value === undefined) {
    warn(`clé inconnue (fr comprise) : ${key}`);
    return '';
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars));
  return interpolate(value, vars);
}

// Variante explicite pour les valeurs tableau (listes). Renvoie [] si absent.
export function tList(key, vars) {
  const value = lookup(key);
  if (!Array.isArray(value)) {
    if (value === undefined) warn(`liste inconnue : ${key}`);
    return [];
  }
  return value.map((v) => interpolate(v, vars));
}

// Existe-t-elle ? Utile pour retomber sur une valeur envoyée par le serveur
// (libellés de formules, catégories saisies par l'utilisateur…).
export function has(key) {
  return key in dict || key in base;
}

// --- Formats localisés ------------------------------------------------------
// Toujours passer par Intl, jamais par un replace(',', '.') : le séparateur, la
// place du symbole € et l'espace insécable diffèrent entre fr-BE (9,90 €),
// en-GB (€9.90) et nl-BE (€ 9,90).
const intlCache = new Map();
function intl(kind, opts) {
  const key = `${kind}|${lang}|${JSON.stringify(opts || {})}`;
  let f = intlCache.get(key);
  if (!f) {
    const Ctor = kind === 'n' ? Intl.NumberFormat : kind === 'd' ? Intl.DateTimeFormat : Intl.RelativeTimeFormat;
    f = new Ctor(localeTag(), opts);
    intlCache.set(key, f);
  }
  return f;
}

export function n(value, opts) {
  return intl('n', opts).format(Number(value) || 0);
}

// Montant en euros. `digits` force un nombre de décimales (coût unitaire à 3).
export function money(value, digits) {
  const opts = { style: 'currency', currency: 'EUR' };
  if (digits !== undefined) {
    opts.minimumFractionDigits = digits;
    opts.maximumFractionDigits = digits;
  }
  return intl('n', opts).format(Number(value) || 0);
}

export function percent(value) {
  return intl('n', { style: 'percent', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

// Deux formats de date cohabitent côté serveur : SQLite « 2026-09-13 17:31:29 »
// (UTC, sans fuseau) et ISO « …T17:31:29.746Z » écrit par Node. On ne rajoute
// le « Z » que sur le premier, sinon Date() renvoie Invalid Date.
export function parseServerDate(s) {
  if (!s) return null;
  const iso = /[TZ]/.test(s) ? s : String(s).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function date(value, opts) {
  const d = value instanceof Date ? value : parseServerDate(value);
  return d ? intl('d', opts).format(d) : '';
}

const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase(localeTag()) + s.slice(1) : s);

// « Il y a 2 h », « Hier », « 2 hr. ago », « gisteren » : Intl.RelativeTimeFormat
// gère la formulation, on ne compose rien à la main.
export function relative(value, unit, { capitalize = true, numeric = 'always' } = {}) {
  const out = intl('r', { numeric, style: 'short' }).format(value, unit);
  return capitalize ? cap(out) : out;
}

// --- Hydratation du DOM -----------------------------------------------------
//   data-i18n="cle"                         → textContent
//   data-i18n-html="cle"                    → innerHTML (valeurs _html)
//   data-i18n-attr="placeholder:cle;alt:c2" → setAttribute (placeholder, alt,
//                                             title, aria-label, content…)
export function applyDom(root = document) {
  // Sans dictionnaire, t() renvoie '' partout : hydrater viderait les libellés.
  // On laisse alors le texte HTML statique (français de référence) intact.
  if (!loaded) return;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const sep = pair.indexOf(':');
      if (sep < 0) continue;
      const attr = pair.slice(0, sep).trim();
      const key = pair.slice(sep + 1).trim();
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

// --- En-tête : langue du document, Open Graph, canonique, hreflang ----------
function applyHead() {
  const L = LOCALES[lang];
  document.documentElement.lang = L.html;

  const set = (sel, attr, value) => {
    const el = document.head.querySelector(sel);
    if (el) el.setAttribute(attr, value);
  };

  set('meta[property="og:locale"]', 'content', L.og);
  // og:locale:alternate : les deux autres langues, dans l'ordre déclaré.
  const alts = LANGS.filter((c) => c !== lang);
  document.head.querySelectorAll('meta[property="og:locale:alternate"]').forEach((el, i) => {
    if (alts[i]) el.setAttribute('content', LOCALES[alts[i]].og);
    else el.remove();
  });

  // Canonique et og:url portent ?lang= pour les langues non par défaut, en
  // cohérence avec les hreflang écrits en dur dans le <head>.
  const canonical = document.head.querySelector('link[rel="canonical"]');
  if (canonical) {
    const url = new URL(canonical.getAttribute('href'), location.origin);
    if (lang === DEFAULT_LANG) url.searchParams.delete('lang');
    else url.searchParams.set('lang', lang);
    canonical.setAttribute('href', url.toString());
    set('meta[property="og:url"]', 'content', url.toString());
  }

  // Données structurées : le nom du produit n'est pas écrit dans le HTML, on
  // l'injecte ici depuis la constante, avec la description traduite.
  const ld = document.head.querySelector('script[type="application/ld+json"][data-i18n-ld]');
  if (ld) {
    try {
      const data = JSON.parse(ld.textContent);
      data.name = BRAND;
      data.inLanguage = L.html;
      const key = ld.dataset.i18nLd;
      if (key && has(key)) data.description = t(key);
      ld.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      warn(`données structurées illisibles : ${e.message}`);
    }
  }
}

// --- Sélecteur de langue ----------------------------------------------------
// <select> natif : accessible au clavier sans code, cible tactile de 44 px sous
// `lg` (h-11) et compacte au-delà (lg:h-8), anneau de focus visible.
const SELECT_CLASS =
  'h-11 lg:h-8 pl-md pr-lg rounded border border-outline-variant bg-surface-container-lowest ' +
  'text-on-surface-variant font-label-md text-label-md cursor-pointer transition-colors ' +
  'hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2';

export function renderLanguageSwitch({ id = 'lang-switch', full = false } = {}) {
  const options = LANGS.map(
    (code) => `<option value="${code}"${code === lang ? ' selected' : ''}>${LOCALES[code].label}</option>`
  ).join('');
  return `<select id="${id}" class="js-lang ${SELECT_CLASS}${full ? ' w-full' : ''}"
      aria-label="${t('nav.language')}" title="${t('nav.language')}">${options}</select>`;
}

export function wireLanguageSwitch(root = document) {
  root.querySelectorAll('select.js-lang').forEach((sel) => {
    if (sel.dataset.wired) return;
    sel.dataset.wired = '1';
    sel.addEventListener('change', () => setLang(sel.value));
  });
}

// --- Amorçage ---------------------------------------------------------------
async function init() {
  lang = detect();
  // Français (filet de secours) et langue cible EN PARALLÈLE : en séquence,
  // EN/NL payaient deux allers-retours avant la révélation de la page.
  // allSettled plutôt que all : l'échec de l'un ne doit pas faire perdre l'autre.
  const [fr, target] = await Promise.allSettled([
    fetchDict(DEFAULT_LANG),
    lang === DEFAULT_LANG ? Promise.resolve(null) : fetchDict(lang),
  ]);
  if (fr.status === 'fulfilled') base = fr.value;
  else console.error('[i18n] dictionnaire français injoignable :', fr.reason);
  if (lang !== DEFAULT_LANG && target.status === 'fulfilled') {
    dict = target.value;
  } else {
    if (target.status === 'rejected') console.error(`[i18n] dictionnaire « ${lang} » injoignable, repli sur le français :`, target.reason);
    lang = DEFAULT_LANG;
    dict = base;
  }
  if (!Object.keys(dict).length) {
    // Aucun dictionnaire : on laisse le HTML de référence (français) en place
    // plutôt que de l'hydrater avec des chaînes vides. La révélation a lieu
    // dans tous les cas.
    console.error('[i18n] chargement impossible, la page reste en français (HTML statique).');
    return;
  }
  loaded = true;
  try {
    applyHead();
    applyDom(document);
  } catch (err) {
    console.error('[i18n] hydratation incomplète :', err);
  }
}

export const ready = init().finally(() => {
  // Rend la main à i18n-boot.js : la page redevient visible, traduite ou non.
  if (typeof window.__i18nReveal === 'function') window.__i18nReveal();
});

// `await` de plus haut niveau : tout importateur attend ici. C'est ce qui rend
// t() utilisable directement dans les gabarits, sans promesse à câbler.
await ready;
