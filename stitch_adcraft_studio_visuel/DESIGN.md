---
name: AdCraft Studio
colors:
  surface: '#f9f9f8'
  surface-dim: '#dadad9'
  surface-bright: '#f9f9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f3'
  surface-container: '#eeeeed'
  surface-container-high: '#e8e8e7'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#434655'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f1f0'
  outline: '#747686'
  outline-variant: '#c4c5d7'
  surface-tint: '#2151da'
  primary: '#0037b0'
  on-primary: '#ffffff'
  primary-container: '#1d4ed8'
  on-primary-container: '#cad3ff'
  inverse-primary: '#b7c4ff'
  secondary: '#625d5b'
  on-secondary: '#ffffff'
  secondary-container: '#e9e1dd'
  on-secondary-container: '#686361'
  tertiary: '#7f2500'
  on-tertiary: '#ffffff'
  tertiary-container: '#a73400'
  on-tertiary-container: '#ffc9b7'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b7c4ff'
  on-primary-fixed: '#001551'
  on-primary-fixed-variant: '#0039b5'
  secondary-fixed: '#e9e1dd'
  secondary-fixed-dim: '#ccc5c2'
  on-secondary-fixed: '#1e1b19'
  on-secondary-fixed-variant: '#4a4643'
  tertiary-fixed: '#ffdbcf'
  tertiary-fixed-dim: '#ffb59c'
  on-tertiary-fixed: '#390c00'
  on-tertiary-fixed-variant: '#832700'
  background: '#f9f9f8'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-max: 1280px
  gutter: 20px
---

## Brand & Style

The design system is built on the principle of **Neutral Framer**. As a tool for creating high-end advertising visuals, the interface serves as a sophisticated, silent gallery. It must not compete with the user's creative output. 

The aesthetic is heavily influenced by **High-End Minimalism**, similar to modern developer and creative tools. It utilizes a chromatically neutral palette, surgical precision in alignment, and a strict reduction of visual noise. There are no gradients, no skeuomorphism, and no decorative shadows. Depth is achieved through fine borders and subtle tonal shifts rather than elevation. 

The emotional response should be one of **utmost clarity, professional efficiency, and premium reliability**.

## Colors

This design system employs a restricted palette to maintain focus on the generated content. 

- **Background & Surfaces**: Use `#FAFAF9` for the main application background and `#FFFFFF` for interactive surfaces and containers.
- **Typography**: Primary text (`#1C1917`) is reserved for high-contrast readability. Secondary text (`#78716C`) handles metadata and labels.
- **Borders**: All structural separation is handled by `#E7E5E4`.
- **Accents**: Blue (`#1D4ED8`) is used exclusively for primary calls to action (e.g., "Générer", "Publier").
- **Status**: Red (`#DC2626`) and Green (`#059669`) are used purely for functional feedback (Error/Success), never for decorative purposes.

**Note:** All interface copy must be in French.

## Typography

The system uses **Inter** exclusively. To maintain a disciplined hierarchy, the system is restricted to two weights: **Regular (400)** and **Semi-bold (600)**. 

- Use Semi-bold for headings, labels, and primary button text to create immediate visual hierarchy.
- Use Regular for body copy and descriptions.
- Tighten letter spacing slightly on larger display styles to enhance the "high-end" technical feel.
- Ensure all micro-copy is concise and professionally translated into French.

## Layout & Spacing

The layout follows a **Rigid Grid** philosophy to reflect the precision of AI generation. 

- **Grid**: A 12-column desktop grid with 20px gutters. 
- **Rhythm**: All spacing (margins, padding, gaps) must be multiples of the 4px base unit. 
- **Safe Areas**: Use 24px (lg) margins for main application containers.
- **Sidebars**: Right-hand property panels for AI settings should have a fixed width (e.g., 320px) to ensure the central canvas remains stable.
- **Mobile**: On mobile devices, the layout collapses into a single column with 16px horizontal padding.

## Elevation & Depth

This design system avoids shadows entirely to maintain a flat, modern aesthetic. 

- **Borders as Depth**: Depth is communicated via 1px solid borders (`#E7E5E4`). 
- **Tonal Layering**: Higher-level elements (like modals or floating toolbars) are differentiated by their white background (`#FFFFFF`) against the slightly off-white application background (`#FAFAF9`).
- **Interactive States**: Hover states should be indicated by a very subtle background shift (e.g., to `#F5F5F4`) or a slightly darker border color, rather than a shadow or glow.

## Shapes

The shape language is strictly controlled to appear technical and precise. 

- **Base Radius**: All primary UI elements (inputs, buttons, cards) use a **6px** radius.
- **Large Elements**: Larger containers or modals may use an **8px** radius to soften the focus slightly.
- **Square Corners**: Inner elements that sit flush against a container corner should have their radius removed to maintain geometric alignment.

## Components

- **Buttons (Boutons)**:
  - **Primaire**: Blue background (`#1D4ED8`), white text, 6px radius.
  - **Secondaire**: White background, 1px border (`#E7E5E4`), text `#1C1917`.
  - **Text labels**: "Générer", "Enregistrer", "Annuler".

- **Input Fields (Champs de saisie)**: 
  - 1px border (`#E7E5E4`), 6px radius.
  - Placeholder text in `#78716C`.
  - Focus state: Border color shifts to `#1D4ED8` without a glow.

- **Chips (Badges)**: 
  - Minimalist style. Small font size (label-sm), light gray background, no border. Used for AI tags or status.

- **Cards (Cartes/Visualisations)**:
  - White background, 1px border. 
  - No shadow. 
  - This is the primary container for the "AdCraft" output. The card itself is a neutral frame for the colorful AI image inside.

- **Toolbars (Barres d'outils)**: 
  - Positioned at the top or bottom of the canvas. 
  - Separated by a 1px border. 
  - Use icon buttons (20px icons) with clear French tooltips.

- **Lists (Listes)**: 
  - Clean rows separated by 1px horizontal lines. 
  - Use `body-sm` for secondary info like "Modifié il y a 2 min".