// Source unique de la logique de prompt.
// Le workflow n8n est GÉNÉRÉ depuis ce fichier (node tools/build-n8n.mjs) :
// ne jamais éditer n8n/generateur-publicite.json à la main.
//
// Pipeline :
//   1. Directeur Artistique (modèle texte multimodal, VOIT les photos) →
//      inventaire des produits (combien, lesquels, forme) + UNE scène pour le
//      thème demandé, en JSON.
//   2. Build Prompt → lead + PRODUCTS (énumération explicite) + SCENE + FIDELITY + AVOID
//   3. Modèle image (Nano Banana) avec les photos en référence.
//
// Principe des thèmes : le thème définit le MONDE (arène pour Sport, fête pour
// Nuit…) ; le produit choisit la variante et les accessoires dans ce monde.
// Avant, c'était l'inverse (« le thème est un style appliqué à l'environnement
// naturel du produit ») → Sport donnait un vestiaire avec une haltère.

export const THEMES = ['classique', 'ete', 'extravagant', 'sport', 'fete', 'luxe', 'noel'];
export const CATEGORIES = ['boisson', 'boisson énergisante', 'alcool', 'chips', 'snack', 'cosmétique', 'parfum', 'épicerie', 'autre'];
export const MAX_PRODUCTS = 6;

// --- Blocs communs ---------------------------------------------------------

// Ligne d'identification du sujet. N produits → formulation plurielle.
export const lead = (brand, category, flavor, description, productCount) => {
  const n = Number(productCount) || 1;
  const subject = n > 1 ? `${n} ${brand} products (${category})` : `${brand} ${category}`;
  return `Professional advertising photograph of ${subject}${description ? ` — ${description}` : ''}${flavor ? `, ${flavor} flavor` : ''}.`;
};

// Énumération explicite des produits. Le modèle image suit bien mieux « exactly
// 3 products: A, B, C » qu'un « every product » implicite. `products` vient de
// l'inventaire du DA (ou d'un repli sur le nombre saisi par l'utilisateur).
export function productsBlock(products = [], productCount = null) {
  const n = products.length || Number(productCount) || 0;
  if (n <= 1) {
    return 'PRODUCTS: exactly one product, the one shown in the reference images. It is the single hero of the image, fully visible and unobstructed.';
  }
  const list = products.length
    ? products.map((p, i) => `${i + 1}. ${[p.name, p.form].filter(Boolean).join(' — ')}`).join('; ')
    : `${n} distinct products shown across the reference images`;
  return (
    `PRODUCTS: exactly ${n} distinct products, all in the same frame, none missing, none duplicated, none invented: ${list}. ` +
    'Each reference image may show one or several of them; if several photos show the same product from different angles, it is still ONE product. ' +
    'Arrange them as one group in the same scene, staggered in depth (hero slightly in front), every label facing the camera, each product fully visible and unobstructed.'
  );
}

// Fidélité : les IMAGES priment sur le texte.
export const FIDELITY =
  'FIDELITY: the reference images are the ground truth. Reproduce each product exactly as photographed — real packaging shape, label, logo, brand name, ' +
  'flavor and colors, photorealistic and unchanged. Keep every piece of packaging text pixel-exact, sharp, legible and in focus; never rewrite, translate, ' +
  'invent or distort any text. If the written brand or flavor conflicts with the images, follow the images. Scale, proportions and materials of the packaging stay real.';

export const AVOID =
  'AVOID: altered or invented packaging text, distorted or redrawn logo, missing or duplicated reference products, extra products not in the references, ' +
  'hands, faces, recognizable people, watermarks, added slogans or captions, cartoon or illustration style, visible AI artefacts, cluttered composition.';

// --- Briefs de thème (pour le Directeur Artistique) ------------------------
// Chaque brief : intention, décors candidats, lumière, palette, énergie,
// caméra, ce qui est interdit. Le DA en choisit UN, adapté au produit.
export const THEME_BRIEFS = {
  classique: {
    label: 'Classique',
    intent: 'Clean premium catalogue shot. The product is the whole story: quiet set, perfect light, nothing competing with the packaging.',
    settings: [
      'seamless studio backdrop in a tone derived from the packaging colors',
      'matte stone or ceramic tabletop with a soft graduated wall behind',
      'linen-covered surface with one shallow window-light shadow',
    ],
    light: 'large softbox key from one side, gentle rim light to separate the product from the backdrop, soft natural shadow',
    palette: 'two or three tones derived from the packaging, neutral and calm',
    energy: 'still, composed, editorial',
    camera: 'eye level or slightly above, 85mm look, shallow but readable depth of field',
    props: 'at most two small real props tied to the product (an ingredient, a glass), placed off-centre, never touching the label',
    forbid: 'busy scenes, landscapes, kitchens, farms, smoke, neon, podiums with gold trim',
  },
  ete: {
    label: 'Été',
    intent: 'Heat and light. Outdoor summer moment where this product is naturally consumed or shown; the sun does the work.',
    settings: [
      'sunlit terrace table with hard midday shadows',
      'poolside deck, wet tiles and bright reflections',
      'beach towel on dry sand, sea and horizon out of focus',
      'picnic blanket in tall golden grass',
      'seaside rocks with sea spray in the background',
      'rooftop at golden hour, city haze behind',
    ],
    light: 'strong direct sun, crisp hard-edged shadows, warm bounce, slight lens flare acceptable',
    palette: 'saturated summer tones: azure, sand, coral, lime, warm white',
    energy: 'relaxed, bright, vacation',
    camera: 'low sun angle, wide-ish lens, product in the near foreground',
    props: 'only what belongs to the product (citrus and ice for a drink, sunglasses or a straw hat for a cosmetic, a bowl for snacks), maximum three',
    forbid: 'ice cubes or condensation on non-beverage products, indoor scenes, wet sand under food packaging, generic stock-photo beach clichés',
  },
  extravagant: {
    label: 'Extravagant',
    intent: 'Maximalist, surreal, poster-grade — but built on ONE big idea, executed cleanly so the packaging stays sharp.',
    settings: [
      'monumental sculptural set of mirrors, chrome and colored acrylic blocks',
      'surreal scale: the product towers over a miniature landscape',
      'product levitating in a void of saturated color with a single dynamic element',
      'infinite reflective floor with giant floating shapes echoing the packaging colors',
      'theatrical stage with colored spotlights and dramatic haze',
    ],
    light: 'dramatic colored spotlights, strong chiaroscuro, glossy highlights',
    palette: 'bold complementary color blocking pushed to the extreme, built from the packaging colors',
    energy: 'explosive but controlled: one frozen high-speed element, not a storm of everything',
    camera: 'dynamic low or Dutch angle, wide lens, product centred and large in frame',
    props: 'one dynamic element matched to the product (liquid crown for a drink, flying crumbs for a snack, silk or petals for a perfume, sparks for tech), nothing else',
    forbid: 'electric arcs plus smoke plus shattered ice plus sparks all at once, anything covering the label, cartoon look',
  },
  sport: {
    label: 'Sport',
    intent: 'The arena, not the equipment room. The product sits inside a real sports place in the middle of the action, and the frame carries effort, speed and sweat.',
    settings: [
      'running track lane under stadium floodlights at dusk',
      'outdoor basketball court at golden hour, painted lines and chain net',
      'boxing ring corner, ropes and canvas under a hard overhead light',
      'mountain trail at dawn, dust and mist, rocky ground',
      'swimming pool edge with lane ropes and water droplets on the tiles',
      'concrete skate park bowl with long evening shadows',
      'football pitch touchline in light rain, floodlights flaring',
      'climbing wall, chalk dust in the air',
    ],
    light: 'hard directional light: low sun or floodlights, strong rim light, high contrast, deep shadows',
    palette: 'punchy high-contrast: the packaging colors against concrete, tarmac, turf or steel',
    energy: 'kinetic: water spray, chalk or dust kicked up, condensation droplets, motion-blurred athletes as distant silhouettes with no visible faces',
    camera: 'very low angle at ground level, wide lens, product large in the foreground, action blurred behind',
    props: 'the surface itself plus one or two sport objects in use (a ball mid-bounce, a towel, a whistle, chalk), never arranged as a still life',
    forbid: 'locker rooms, benches, empty gyms, isolated dumbbells or kettlebells, yoga mats, water bottles as decoration, clean white studios',
  },
  fete: {
    label: 'Nuit',
    intent: 'A night celebration in full swing: party energy, colored light, people present only as blurred silhouettes and bokeh.',
    settings: [
      'rooftop bar at night with city lights bokeh behind',
      'cocktail bar counter with backlit bottles and wet glossy reflections',
      'house-party table with confetti, streamers and a string of festoon lights',
      'concert backstage or DJ booth, haze and colored beams',
      'New Year table at midnight, sparklers and glitter',
    ],
    light: 'neon and practical lights, colored gels (magenta, electric blue, amber), specular reflections on wet or glossy surfaces',
    palette: 'deep night blues and blacks with magenta, gold and electric accents',
    energy: 'loud, festive, alive: confetti mid-air, glitter, blurred dancing crowd in the far background',
    camera: 'eye level to slightly low, shallow depth of field, product sharp against bokeh',
    props: 'confetti, glasses, sparklers, garlands — what a party actually has, maximum three kinds',
    forbid: 'empty clubs, daylight, faces, hands holding the product, sterile bar shots',
  },
  luxe: {
    label: 'Luxe',
    intent: 'Restraint and materials. Luxury reads through texture, precise light and empty space, not through gold trim.',
    settings: [
      'penthouse table at blue hour, floor-to-ceiling window and city lights out of focus',
      'boutique display in brushed brass, walnut and smoked glass',
      'hotel bar in leather and dark walnut with a single warm lamp',
      'velvet or heavy silk drape studio in a color drawn from the packaging',
      'polished stone slab with a thin shaft of light across it',
    ],
    light: 'single soft key with a precise rim, deep controlled shadows, one specular highlight on the packaging',
    palette: 'derived from the packaging: deep green, burgundy, ivory, champagne, graphite — black-and-gold only if the packaging is black and gold',
    energy: 'silent, slow, exclusive',
    camera: 'eye level, longer lens, generous negative space, product slightly off-centre',
    props: 'at most one precious object (crystal glass, silk ribbon, a single flower), never a pedestal',
    forbid: 'marble podiums with gold rims, smoke wisps, spotlights from above, jewellery-store clichés, cluttered sets',
  },
  noel: {
    label: 'Noël',
    intent: 'One Christmas register, chosen and committed to — cosy fireside, festive table or wintry outdoor — not all of them stacked in one frame.',
    settings: [
      'fireside on a wool blanket, warm out-of-focus fairy lights behind',
      'festive dining table: linen, candles, cinnamon, dried oranges, one sprig of fir',
      'snowy cabin window sill at dusk, frost on the glass, warm light inside',
      'outdoor snowy pine branch at blue hour with a soft glow',
      'gift-wrapping table with kraft paper, ribbon and a pair of scissors',
    ],
    light: 'warm tungsten and candlelight, soft bokeh, cool blue in the shadows for contrast',
    palette: 'packaging colors first, then traditional accents: deep red, forest green, warm gold, snow white',
    energy: 'calm, warm, generous',
    camera: 'eye level, shallow depth of field, product sharp among soft festive bokeh',
    props: 'three at most, all from the chosen register (no baubles on a snowy branch scene, no snow on a dining table)',
    forbid: 'baubles + snow + fireplace + tree + fairy lights all together, red-and-green-only palette, cartoon Santa elements',
  },
};

// --- Presets statiques (REPLI quand le DA échoue) ---------------------------
// Rédigés à partir des briefs : agnostiques au produit, énergie du thème
// respectée, un seul décor par thème.
export const PRESETS = {
  classique:
    'SCENE: clean premium studio set. The product stands on a matte stone tabletop in front of a seamless backdrop graded in a tone taken from its packaging. ' +
    'LIGHT: large softbox from the left, gentle rim light, one soft natural shadow. PALETTE: two or three calm tones derived from the packaging. ' +
    'CAMERA: eye level, 85mm look, shallow but readable depth of field. MOOD: still, composed, editorial catalogue shot.',
  ete:
    'SCENE: sunlit outdoor terrace table at midday, sea horizon and greenery out of focus behind; the product sits in the near foreground on warm weathered wood. ' +
    'LIGHT: strong direct sun, crisp hard shadows, warm bounce, faint lens flare. PALETTE: azure, sand, coral, warm white. ' +
    'CAMERA: low sun angle, wide lens, product large in frame. MOOD: bright, relaxed summer heat. Props only if they belong to the product, three at most.',
  extravagant:
    'SCENE: monumental surreal set — an infinite glossy reflective floor with giant floating chrome and colored acrylic shapes echoing the packaging colors; the product ' +
    'levitates at the centre with ONE frozen dynamic element that belongs to it. LIGHT: dramatic colored spotlights, strong chiaroscuro, glossy highlights. ' +
    'PALETTE: bold complementary color blocking from the packaging. CAMERA: dynamic low angle, wide lens, product centred and large. MOOD: maximalist, poster-grade, controlled.',
  sport:
    'SCENE: running track lane inside a stadium at dusk under floodlights; the product stands on the wet rubber track in the near foreground, motion-blurred athletes as ' +
    'distant silhouettes behind, water spray and dust caught in the light. LIGHT: hard floodlights and low sun, strong rim light, high contrast. ' +
    'PALETTE: packaging colors against dark track, white lane lines and steel. CAMERA: ground-level low angle, wide lens. MOOD: kinetic, effort, adrenaline — no locker room, no gym equipment.',
  fete:
    'SCENE: rooftop bar at night in full swing; the product stands on a wet glossy counter, city lights and a blurred dancing crowd as bokeh behind, confetti mid-air. ' +
    'LIGHT: neon and festoon lights, magenta and electric-blue gels, specular reflections. PALETTE: deep night blue, magenta, gold accents. ' +
    'CAMERA: eye level, shallow depth of field, product sharp against bokeh. MOOD: loud, festive, alive.',
  luxe:
    'SCENE: penthouse table at blue hour, floor-to-ceiling window with city lights out of focus; the product rests slightly off-centre on a polished dark stone slab with ' +
    'generous negative space. LIGHT: single soft key, precise rim, deep controlled shadows, one specular highlight on the packaging. ' +
    'PALETTE: derived from the packaging, deep and restrained. CAMERA: eye level, longer lens. MOOD: silent, exclusive — no podium, no gold trim, no smoke.',
  noel:
    'SCENE: festive dining table on Christmas Eve — natural linen, two lit candles, dried orange slices and one sprig of fir; the product stands sharp among soft warm bokeh. ' +
    'LIGHT: warm candlelight and tungsten, cool blue in the shadows. PALETTE: packaging colors first, then deep red, forest green and warm gold. ' +
    'CAMERA: eye level, shallow depth of field. MOOD: calm, warm, generous — one register only, no snow, no baubles.',
};

// --- Directeur Artistique -------------------------------------------------

export const DA_SYSTEM = `You are an art director for commercial product photography. You receive a brief AND the actual reference photos of the product(s). You return ONE JSON object.

STEP 1 — INVENTORY. Look at every reference photo. List each DISTINCT product (packaging unit) visible across ALL photos. Two photos of the same packaging from different angles are ONE product. One photo may contain several different products: list each of them. For each product give a short name (as printed on the packaging), its physical form (can, bottle, bag, jar, box, tube…) and its dominant packaging colors. If the brief states an expected product count, honor it and reconcile with what you see.

STEP 2 — SCENE. The theme brief defines the WORLD of the picture (its settings, light, energy). Choose ONE candidate setting from the brief that fits what the product is and when it is consumed, then make it concrete: the exact surface the product(s) rest on, at most three props that belong to that world AND to that product, the framing, the light, the palette (start from the packaging colors), the mood. Never leave the theme's world for the product's "natural environment": a Sport theme is an arena, not a gym storage room; a Luxe theme is materials and restraint, not a gold podium.

STEP 3 — ARRANGEMENT. If there are several products, describe how they are grouped in one frame so that every label faces the camera and no product hides another.

Rules:
- Be concrete and specific: "wet rubber running track, white lane lines, floodlights flaring at the top of frame" beats "sports field".
- Never describe the product's own packaging, label, logo or text in the scene fields. Another system handles fidelity.
- No people in the foreground, no hands, no faces. Distant motion-blurred silhouettes are allowed only when the theme brief allows them.
- No text, signs or logos anywhere in the set.
- Respect the theme's FORBID list literally.
- Keep each string under 30 words. Output the JSON object only.`;

export const DA_SCHEMA = {
  type: 'object',
  required: ['products', 'setting', 'surface', 'props', 'arrangement', 'framing', 'light', 'palette', 'mood'],
  properties: {
    products: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PRODUCTS,
      items: {
        type: 'object',
        required: ['name', 'form', 'colors'],
        properties: { name: { type: 'string' }, form: { type: 'string' }, colors: { type: 'string' } },
      },
    },
    setting: { type: 'string' },
    surface: { type: 'string' },
    props: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    arrangement: { type: 'string' },
    framing: { type: 'string' },
    light: { type: 'string' },
    palette: { type: 'string' },
    mood: { type: 'string' },
  },
};

// Brief textuel envoyé au DA pour un thème.
export function themeBriefText(theme) {
  const b = THEME_BRIEFS[theme] || THEME_BRIEFS.classique;
  return [
    `THEME: ${b.label}`,
    `INTENT: ${b.intent}`,
    `CANDIDATE SETTINGS (choose one): ${b.settings.map((s, i) => `(${i + 1}) ${s}`).join(' ')}`,
    `LIGHT: ${b.light}`,
    `PALETTE: ${b.palette}`,
    `ENERGY: ${b.energy}`,
    `CAMERA: ${b.camera}`,
    `PROPS: ${b.props}`,
    `FORBID: ${b.forbid}`,
  ].join('\n');
}

export const daUserText = ({ brand, category, description, flavor, theme, productCount }) =>
  [
    `brand: ${brand}`,
    `category: ${category}`,
    `description: ${description || '(none)'}`,
    `flavour: ${flavor || '(none)'}`,
    `expected product count: ${productCount ? productCount : '(not specified — count from the photos)'}`,
    '',
    themeBriefText(theme),
  ].join('\n');

// Exemples few-shot (texte seulement : ils fixent le niveau de spécificité et
// l'esprit de chaque thème ; les vraies requêtes ajoutent les photos).
export const DA_FEWSHOT = [
  {
    role: 'user',
    text: daUserText({ brand: 'Red Bull', category: 'boisson énergisante', description: '', flavor: '', theme: 'sport', productCount: 1 }),
  },
  {
    role: 'model',
    text: JSON.stringify({
      products: [{ name: 'Red Bull Energy Drink', form: '250 ml slim can', colors: 'silver, blue, red' }],
      setting: 'outdoor basketball court at golden hour, painted lines and a chain net, a ball mid-bounce blurred behind',
      surface: 'sun-baked painted asphalt with fine dust and a few water droplets',
      props: ['basketball mid-bounce, motion-blurred', 'chalk-like dust kicked up in the backlight'],
      arrangement: 'single can standing upright in the near foreground on the free-throw line',
      framing: 'ground-level low angle, wide lens, can large in frame, court receding behind',
      light: 'low golden sun from behind-left, hard rim light on the can, long shadows, high contrast',
      palette: 'blue and red of the can against warm asphalt and deep shadows',
      mood: 'kinetic, effort, adrenaline',
    }),
  },
  {
    role: 'user',
    text: daUserText({ brand: 'Lay\'s', category: 'chips', description: 'two flavours, two bags', flavor: '', theme: 'fete', productCount: 2 }),
  },
  {
    role: 'model',
    text: JSON.stringify({
      products: [
        { name: "Lay's Classic", form: 'foil crisp bag', colors: 'yellow, red' },
        { name: "Lay's Paprika", form: 'foil crisp bag', colors: 'orange, red' },
      ],
      setting: 'house-party table at night, festoon lights strung above, blurred dancing crowd far behind',
      surface: 'dark wooden table with scattered confetti and a few glossy reflections',
      props: ['confetti mid-air', 'two short tumblers with ice, out of focus', 'a paper party streamer'],
      arrangement: 'the two bags standing side by side, slightly staggered, the Classic bag a few centimetres in front, both labels facing camera',
      framing: 'eye level, shallow depth of field, bags sharp against warm bokeh',
      light: 'warm festoon bulbs above, magenta gel from the right, specular glints on the foil',
      palette: 'deep night blue background, warm gold light, yellow and orange of the bags',
      mood: 'loud, festive, alive',
    }),
  },
  {
    role: 'user',
    text: daUserText({ brand: 'San Pellegrino', category: 'boisson', description: 'glass bottle', flavor: 'lemon', theme: 'luxe', productCount: 1 }),
  },
  {
    role: 'model',
    text: JSON.stringify({
      products: [{ name: 'San Pellegrino Limonata', form: 'glass bottle', colors: 'yellow, green, white' }],
      setting: 'penthouse table at blue hour, floor-to-ceiling window with distant city lights out of focus',
      surface: 'polished dark green stone slab',
      props: ['one crystal tumbler, empty, slightly behind'],
      arrangement: 'single bottle slightly off-centre right, generous negative space on the left',
      framing: 'eye level, longer lens, bottle sharp, window softly blurred',
      light: 'single soft key from the left, precise cool rim from the window, deep controlled shadows',
      palette: 'deep green, graphite, ivory, a touch of lemon yellow from the bottle',
      mood: 'silent, exclusive, precise',
    }),
  },
];

// --- Assemblage final -----------------------------------------------------

// Transforme la réponse DA (validée) en bloc SCÈNE.
export function renderScene(o) {
  const props = (o.props || []).slice(0, 3).join(', ');
  return [
    `SCENE: ${o.setting}. The product${o.products && o.products.length > 1 ? 's rest' : ' rests'} on ${o.surface}.${props ? ` Nearby: ${props}.` : ''}`,
    o.arrangement ? `ARRANGEMENT: ${o.arrangement}` : null,
    `FRAMING: ${o.framing}`,
    `LIGHT: ${o.light}`,
    `PALETTE: ${o.palette}`,
    `MOOD: ${o.mood}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// artDirection (décor libre saisi par l'utilisateur) remplace la SCÈNE du thème
// quand il est fourni — jamais le lead, l'inventaire ni la fidélité.
export function buildPrompt({ brand, category, flavor, theme, description, artDirection, products = [], productCount = null }) {
  const n = products.length || Number(productCount) || 1;
  const scene = artDirection ? `SCENE: ${artDirection}` : PRESETS[theme] || PRESETS.classique;
  return [lead(brand, category, flavor, description, n), productsBlock(products, n), scene, FIDELITY, AVOID].join('\n');
}

// Corps de requête Gemini generateContent (Nano Banana).
export function buildGeminiBody({
  brand,
  category,
  flavor,
  theme,
  description,
  artDirection,
  products = [],
  productCount = null,
  images = [],
  imageSize = '2K', // 0.5K/1K/2K/4K : gemini-3.1-flash-image et gemini-3-pro-image ; omis pour 2.5-flash-image
  aspectRatio = '4:5',
}) {
  const parts = [{ text: buildPrompt({ brand, category, flavor, theme, description, artDirection, products, productCount }) }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } });
  }
  const imageConfig = { aspectRatio };
  if (imageSize) imageConfig.imageSize = imageSize;
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig },
  };
}
