// Politique de mot de passe (inscription + changement). Même règle que le
// front (register.html), mais c'est ici qu'elle fait foi.
//   - 12 à 128 caractères
//   - au moins 3 familles sur 4 : minuscule, majuscule, chiffre, symbole
//   - pas la partie locale de l'email, pas de suite triviale, pas dans la liste
//     des mots de passe les plus courants (extrait)
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

const COMMON = new Set([
  'password', 'password1', 'password123', 'motdepasse', 'azerty', 'azertyuiop', 'qwerty', 'qwertyuiop',
  '123456789012', 'abc123456789', 'iloveyou', 'admin', 'administrator', 'welcome', 'bienvenue', 'letmein',
  'football', 'monkey', 'dragon', 'sunshine', 'princess', 'passw0rd', 'trustno1', 'soleil', 'chocolat',
  'adcraft', 'adcraft2026', 'changeme', 'changeme123',
]);

export function passwordIssues(password, email = '') {
  const p = String(password || '');
  const issues = [];
  if (p.length < MIN_PASSWORD) issues.push(`${MIN_PASSWORD} caractères minimum`);
  if (p.length > MAX_PASSWORD) issues.push(`${MAX_PASSWORD} caractères maximum`);

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length;
  if (classes < 3) issues.push('au moins 3 types parmi : minuscule, majuscule, chiffre, symbole');

  const lower = p.toLowerCase();
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) issues.push("ne doit pas contenir votre adresse e-mail");
  if (/^(.)\1+$/.test(p)) issues.push('caractère répété');
  if (/^(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|azer)/i.test(p) && classes < 4) {
    issues.push('suite trop prévisible');
  }
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9]/g, ''))) issues.push('mot de passe trop courant');

  return issues;
}
