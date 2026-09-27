// Parité des dictionnaires FR / EN / NL.
//
//   cd frontend && npm run check:i18n
//
// Sortie 0 = les trois fichiers ont exactement le même jeu de clés, les mêmes
// types, la même longueur de liste et les mêmes variables {{…}}.
//
// Pourquoi contrôler les variables et pas seulement les clés : une clé présente
// dont l'interpolation diffère est un bug SILENCIEUX. « {{amount}} » oublié
// dans la traduction néerlandaise d'un message de remboursement, et le montant
// disparaît de l'écran sans qu'aucune erreur ne soit levée — sur une page de
// rétractation, c'est exactement le litige qu'on cherche à éviter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const LOCALES = path.join(FRONTEND, 'locales');
const REF = 'fr';
const LANGS = ['fr', 'en', 'nl'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const varsOf = (s) => [...String(s).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');

const dicts = Object.fromEntries(
  LANGS.map((l) => [l, flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, `${l}.json`), 'utf8')))])
);

const ref = dicts[REF];
let problems = 0;
console.log(`Référence ${REF}.json : ${Object.keys(ref).length} clés\n`);

for (const lang of LANGS.filter((l) => l !== REF)) {
  const d = dicts[lang];
  const missing = Object.keys(ref).filter((k) => !(k in d));
  const orphans = Object.keys(d).filter((k) => !(k in ref));
  const typeDiff = [];
  const listDiff = [];
  const varDiff = [];

  for (const k of Object.keys(ref)) {
    if (!(k in d)) continue;
    const a = ref[k];
    const b = d[k];
    if (Array.isArray(a) !== Array.isArray(b) || typeof a !== typeof b) { typeDiff.push(k); continue; }
    if (Array.isArray(a)) {
      if (a.length !== b.length) listDiff.push(`${k} (${a.length} vs ${b.length})`);
      // Les variables des listes comptent autant que celles des chaînes.
      a.forEach((item, i) => {
        if (b[i] !== undefined && varsOf(item) !== varsOf(b[i])) varDiff.push(`${k}[${i}] : ${REF}[${varsOf(item)}] vs ${lang}[${varsOf(b[i])}]`);
      });
      continue;
    }
    if (varsOf(a) !== varsOf(b)) varDiff.push(`${k} : ${REF}[${varsOf(a)}] vs ${lang}[${varsOf(b)}]`);
  }

  const bad = missing.length + orphans.length + typeDiff.length + listDiff.length + varDiff.length;
  problems += bad;
  const list = (items) => (items.length ? '\n      ' + items.join('\n      ') : '');
  console.log(`--- ${lang}.json : ${Object.keys(d).length} clés`);
  console.log(`    manquantes : ${missing.length}${list(missing)}`);
  console.log(`    orphelines : ${orphans.length}${list(orphans)}`);
  console.log(`    types      : ${typeDiff.length}${list(typeDiff)}`);
  console.log(`    listes     : ${listDiff.length}${list(listDiff)}`);
  console.log(`    variables  : ${varDiff.length}${list(varDiff)}`);
}

// --- Clés réellement utilisées par le code ----------------------------------
// t('x'), tList('x'), has('x'), data-i18n="x", data-i18n-html="x",
// data-i18n-ld="x" et data-i18n-attr="placeholder:x;alt:y".
const sources = [
  ...fs.readdirSync(FRONTEND).filter((f) => f.endsWith('.html')).map((f) => path.join(FRONTEND, f)),
  ...fs.readdirSync(path.join(FRONTEND, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join(FRONTEND, 'js', f)),
];

const used = new Set();
// Les commentaires sont retirés avant l'analyse : la documentation de
// js/i18n.js contient l'exemple `data-i18n-attr="placeholder:cle;alt:c2"`, qui
// serait sinon compté comme deux clés manquantes. On ne coupe que les lignes
// ENTIÈREMENT commentées — tronquer à partir du premier « // » amputerait toute
// ligne contenant une URL et ferait disparaître un vrai t() au passage.
const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

for (const file of sources) {
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  // Classe « tout sauf guillemet, espace et ${} » plutôt que [\w.] : \w est
  // ASCII seul et ignorait les clés accentuées (`categories.cosmétique`). Les
  // clés composées (`x.${y}`) restent exclues : elles n'aboutissent pas au
  // guillemet fermant et sont traitées plus bas.
  for (const m of code.matchAll(/\b(?:t|tList|has)\(\s*['"`]([^"'`\s${}]+)['"`]/g)) used.add(m[1]);
  for (const m of code.matchAll(/data-i18n(?:-html|-ld)?=["']([^"'`\s${}]+)["']/g)) used.add(m[1]);
  for (const m of code.matchAll(/data-i18n-attr=["']([^"']+)["']/g)) {
    for (const pair of m[1].split(';')) {
      const key = pair.slice(pair.indexOf(':') + 1).trim();
      if (key) used.add(key);
    }
  }
  // Clés composées : `plans.${p.key}.label`, `themes.${th.value}`, etc. On ne
  // peut pas les résoudre statiquement — on enregistre leur préfixe pour ne pas
  // signaler à tort tout le namespace comme inutilisé.
  for (const m of code.matchAll(/['"`]([\w.]+)\.\$\{/g)) used.add(`${m[1]}.*`);
  for (const m of code.matchAll(/['"`]([\w.]+)\.\$\{[^}]+\}\.([\w.]+)['"`]/g)) used.add(`${m[1]}.*.${m[2]}`);
}

const prefixes = [...used].filter((k) => k.includes('*')).map((k) => k.split('.*')[0]);
const covered = (key) => used.has(key) || prefixes.some((p) => key.startsWith(`${p}.`));

// Pluriels : le code appelle t('x'), le dictionnaire porte x_one / x_other.
const singular = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
const unused = Object.keys(ref).filter((k) => !covered(k) && !covered(singular(k)));
const undeclared = [...used].filter((k) => !k.includes('*') && !(k in ref) && !(`${k}_other` in ref));

console.log(`\n--- clés référencées par le code : ${used.size}`);
console.log(`    absentes de fr.json : ${undeclared.length}${undeclared.length ? '\n      ' + undeclared.join('\n      ') : ''}`);
console.log(`    jamais référencées  : ${unused.length}${unused.length ? '\n      ' + unused.join('\n      ') : ''}`);
// Une clé jamais référencée n'est pas une erreur bloquante (elle peut servir à
// une page en préparation) ; une clé appelée mais absente en est une.
problems += undeclared.length;

if (problems) {
  console.error(`\n❌ ${problems} écart(s).`);
  process.exit(1);
}
console.log('\n✅ Parité stricte : les trois dictionnaires ont le même jeu de clés.');
