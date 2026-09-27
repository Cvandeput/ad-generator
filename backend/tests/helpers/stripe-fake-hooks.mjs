// Hook de résolution ESM : `import('stripe')` → la doublure stripe-fake.mjs.
// Installé uniquement par les tests qui l'enregistrent eux-mêmes.
const FAKE = new URL('./stripe-fake.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'stripe') return { url: FAKE, shortCircuit: true, format: 'module' };
  return nextResolve(specifier, context);
}
