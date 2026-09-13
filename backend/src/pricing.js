// Grille tarifaire des modèles image (USD par image, tarif standard Gemini API /
// Vertex AI, septembre 2026). Source unique du coût enregistré en base : on ne
// déduit plus le prix d'une variable d'env qui dérive du modèle réel.
//
//   gemini-2.5-flash-image      0.039 quelle que soit la taille — ARRÊT le 2 oct. 2026
//   gemini-3.1-flash-image      0.5K 0.045 · 1K 0.067 · 2K 0.101 · 4K 0.151  (Nano Banana 2)
//   gemini-3.1-flash-lite-image 1K 0.0336                                     (Nano Banana 2 Lite)
//   gemini-3-pro-image          1K 0.134 · 2K 0.134 · 4K 0.24                (Nano Banana Pro)
//
// Les suffixes -preview / -001 sont ignorés pour la correspondance.

const PRICES = {
  'gemini-2.5-flash-image': { default: 0.039 },
  'gemini-3.1-flash-image': { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151, default: 0.067 },
  'gemini-3.1-flash-lite-image': { '1K': 0.0336, default: 0.0336 },
  'gemini-3-pro-image': { '1K': 0.134, '2K': 0.134, '4K': 0.24, default: 0.134 },
};

export const RETIRED = {
  // modèle → date d'arrêt (ISO). Utilisé pour avertir au démarrage.
  'gemini-2.5-flash-image': '2026-10-02',
};

export function normalizeModel(model) {
  return String(model || '')
    .trim()
    .toLowerCase()
    .replace(/^(publishers\/google\/)?models\//, '')
    .replace(/-(preview|latest|00\d)(-[a-z0-9-]+)?$/, '');
}

// Coût USD d'une image pour (modèle, taille). Inconnu → null (l'appelant décide).
export function costForModel(model, imageSize) {
  const key = normalizeModel(model);
  const table = PRICES[key];
  if (!table) return null;
  const size = String(imageSize || '').toUpperCase();
  return table[size] ?? table.default;
}

export function knownModels() {
  return Object.keys(PRICES);
}
