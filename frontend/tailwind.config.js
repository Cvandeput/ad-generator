/** @type {import('tailwindcss').Config} */
// Design system AdCraft — identité « D » : papier, encre, accent terracotta.
// Tokens repris tels quels du design pour que le rendu corresponde à la maquette.
// Les classes vivent dans le HTML ET dans les gabarits JS (cartes en template
// literals) : scanner les deux, sinon le JIT n'émet pas leurs utilitaires.
module.exports = {
  content: ['./*.html', './js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      // Identité « D » (table ronde du 25/09/2026, docs locaux) : fond papier
      // chaud, encre, UN seul accent terracotta réservé aux actions. La chaleur
      // passe par la couleur, pas par la police (pas de titre à empattements).
      // Ratios WCAG calculés (luminance relative) ; le grain de input.css
      // (multiply, 12 %) en retire ~0.08 au rendu.
      colors: {
        // Surfaces : papier chaud ; les cartes restent blanches.
        background: '#f6f3ee',
        surface: '#f6f3ee',
        'surface-bright': '#f6f3ee',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f0ebe3',
        'surface-container': '#eae4da',
        'surface-container-high': '#e3dcd0',
        'surface-container-highest': '#dcd4c6',
        'surface-variant': '#dcd4c6',
        'surface-dim': '#d9d1c4',
        'inverse-surface': '#2b2925',
        'inverse-on-surface': '#f3efe8',

        // Texte. on-surface : 15.7:1 sur papier.
        'on-surface': '#1b1a17',
        'on-background': '#1b1a17',
        'on-surface-variant': '#4a463f', // 8.47 papier · 6.38 sur highest
        secondary: '#5e5a52', // 6.20 papier · 4.66 sur highest
        // text-outline (légendes, mentions, placeholders) : 5.79 blanc ·
        // 5.23 papier · 4.88 low · 4.58 container.
        // ⚠ Garde-fou : 4.25 sur surface-container-high et 3.93 sur highest,
        // sous 4.5 — ne pas poser text-outline sur ces deux fonds.
        outline: '#6a655c',

        // Bordures — DEUX rôles distincts (WCAG 1.4.11 ne vise que le premier) :
        // - outline-variant : contour des COMPOSANTS (champs, zone de dépôt,
        //   vignettes, boutons secondaires, cartes). Minimum 3:1 sur leur fond :
        //   3.94 blanc · 3.56 papier · 3.32 low · 3.11 container.
        // - outline-soft : filets DÉCORATIFS (bas de l'en-tête, séparations de
        //   sections, lignes de tableau), volontairement discrets.
        'outline-variant': '#848077',
        'outline-soft': '#e4ddd2',

        // Accent unique : terracotta. primary-container = boutons (blanc dessus :
        // 5.45:1), primary = liens et texte d'accent (6.43 papier).
        primary: '#9c3614',
        'primary-container': '#b8431a',
        'on-primary': '#ffffff',
        'surface-tint': '#b8431a',
        'on-primary-container': '#ffe3d8',
        'primary-fixed': '#f6ddd2',
        'primary-fixed-dim': '#efc0ac',
        'on-primary-fixed': '#3a1204',
        'on-primary-fixed-variant': '#8a2e0e',
        'inverse-primary': '#ffb59a',

        'secondary-container': '#e9e1dd',
        'secondary-fixed': '#e9e1dd',
        'secondary-fixed-dim': '#ccc5c2',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#686361',
        'on-secondary-fixed': '#1e1b19',
        'on-secondary-fixed-variant': '#4a4643',

        tertiary: '#7f2500',
        'tertiary-container': '#a73400',
        'tertiary-fixed': '#ffdbcf',
        'tertiary-fixed-dim': '#ffb59c',
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#ffc9b7',
        'on-tertiary-fixed': '#390c00',
        'on-tertiary-fixed-variant': '#832700',

        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        lg: '0.625rem',
        xl: '0.875rem',
        // full = cercle réel (avatars, pastilles). DESIGN.md front-matter: 9999px.
        full: '9999px',
      },
      spacing: {
        'container-max': '1280px',
        gutter: '20px',
        xl: '48px',
        lg: '24px',
        md: '16px',
        sm: '8px',
        unit: '4px',
        xs: '4px',
      },
      fontFamily: {
        // Titres : Inter Tight serré (net à toutes les tailles, en FR/EN/NL).
        // Corps et labels : Inter. Les deux sont auto-hébergées (css/input.css).
        sans: ['Inter', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', 'sans-serif'],
        'display-xl': ['"Inter Tight"', 'Inter', 'sans-serif'],
        'display-lg': ['"Inter Tight"', 'Inter', 'sans-serif'],
        'display-lg-mobile': ['"Inter Tight"', 'Inter', 'sans-serif'],
        'headline-md': ['"Inter Tight"', 'Inter', 'sans-serif'],
        'body-base': ['Inter', 'sans-serif'],
        'body-sm': ['Inter', 'sans-serif'],
        'label-md': ['Inter', 'sans-serif'],
        'label-sm': ['Inter', 'sans-serif'],
      },
      fontSize: {
        // Titre hero accueil : 60/62, serré (Inter Tight à -0.035em).
        'display-xl': ['60px', { lineHeight: '62px', letterSpacing: '-0.035em', fontWeight: '600' }],
        'display-lg': ['36px', { lineHeight: '40px', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-lg-mobile': ['28px', { lineHeight: '32px', letterSpacing: '-0.03em', fontWeight: '600' }],
        'headline-md': ['21px', { lineHeight: '28px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'body-base': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '18px', fontWeight: '400' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '600' }],
        'label-sm': ['11px', { lineHeight: '14px', fontWeight: '400' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
