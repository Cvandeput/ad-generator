// Source unique de la logique de prompt.
// Le node "Build Prompt" du workflow n8n reflète ce fichier (n8n ne peut pas
// importer de module local) — garder les deux synchronisés.
//
// Structure : chaque thème = une SCÈNE complète et dominante (fond, placement,
// lumière, palette, ambiance tous différents) → vraies variantes.
//   prompt = lead (produit) + scène du thème + fidélité packaging

// La description précise la forme réelle du produit (« croissant fourré au
// Nutella ») quand la catégorie ne suffit pas. Elle n'a sa place que dans la
// première ligne, celle qui identifie le sujet — jamais dans le décor.
export const lead = (brand, category, flavor, description) =>
  `Professional advertising photograph of ${brand} ${category}${description ? ` — ${description}` : ''}${flavor ? `, ${flavor} flavor` : ''}.`;

// Contrainte de fidélité, courte et en fin (ne doit pas dominer la scène).
export const FIDELITY =
  'Keep the exact product packaging, label, logo and typography from the reference image unchanged and photorealistic.';

// Interdits explicites : Nano Banana répond mieux à des négatifs clairs qu'à des
// formulations positives seules.
export const AVOID =
  'AVOID: altered or invented packaging text, distorted logo, extra products, hands, faces, ' +
  'watermarks, added slogans, cartoon or illustration style, visible AI artefacts.';

export const PRESETS = {
  classique:
    'Iconic minimalist studio advertisement: the product stands centered on a glossy reflective surface in front of ' +
    "a smooth gradient backdrop in the brand's signature colors, crisp softbox studio lighting with a subtle rim light, " +
    'clean high-end commercial poster look, sharp product focus, neutral elegant composition.',
  ete:
    'Bright outdoor summer beach scene: the product sits on golden sand next to splashing turquoise water and scattered ' +
    'ice cubes, palm-leaf shadows, clear blue sky, strong warm sunlight, vivid saturated summer colors, fresh condensation ' +
    'droplets, relaxed vacation lifestyle mood, shallow depth of field.',
  extravagant:
    'Maximalist surreal advertisement: the product levitates at the center of an explosive energy burst with splashing ' +
    'liquid crowns, crackling electric arcs, shattered flying ice and swirling neon-colored smoke and sparks, dramatic ' +
    'chiaroscuro spotlight, bold clashing complementary colors, dynamic diagonal composition, frozen high-speed motion, ' +
    'luxurious futuristic set, hyper-detailed.',
  sport:
    'High-energy sports action scene: the product on the rough concrete of an urban court or stadium track at golden hour, ' +
    'shot from a dynamic low camera angle, motion-blurred athletes and flying water and dust in the background, dramatic ' +
    'hard rim lighting, punchy high-contrast colors, intense adrenaline mood.',
  fete:
    'Vibrant nightclub party scene: the product on a glossy bar counter surrounded by glowing purple and blue neon lights ' +
    'and laser beams, a blurred dancing crowd as colorful bokeh, dark atmosphere with vivid colored reflections on a wet ' +
    'surface, cinematic night color grade, energetic festive mood.',
  luxe:
    'Ultra-premium luxury scene: the product on a polished dark marble pedestal with soft golden accent lighting and ' +
    'elegant deep shadows, minimalist sophisticated set, a wisp of subtle smoke, moody overhead spotlight, sleek exclusive ' +
    'editorial aesthetic, refined black-and-gold palette.',
  noel:
    'Cozy Christmas winter scene: the product on a rustic wooden table surrounded by soft snow, pine branches, red baubles ' +
    'and warm glowing fairy-light bokeh, a soft fireplace glow in the background, warm golden festive color palette, ' +
    'magical holiday mood.',
};

// artDirection (décor libre saisi par l'utilisateur) remplace la SCÈNE du thème
// quand il est fourni — jamais le lead ni la fidélité packaging. C'est le
// contrôle manuel « à la Sora » : une idée précise prime sur le preset.
export function buildPrompt({ brand, category, flavor, theme, description, artDirection }) {
  const scene = artDirection || PRESETS[theme] || PRESETS.classique;
  return `${lead(brand, category, flavor, description)} ${scene} ${FIDELITY} ${AVOID}`;
}

// Corps de requête Gemini generateContent (Nano Banana).
export function buildGeminiBody({
  brand,
  category,
  flavor,
  theme,
  description,
  artDirection,
  images = [],
  imageSize = null,
  aspectRatio = '1:1',
}) {
  const parts = [{ text: buildPrompt({ brand, category, flavor, theme, description, artDirection }) }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } });
  }
  // imageSize (paliers 1K/2K/4K) : seulement Gemini 3 image. Omis si absent (ex: 2.5).
  const imageConfig = { aspectRatio };
  if (imageSize) imageConfig.imageSize = imageSize;
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig,
    },
  };
}
