---
version: alpha
name: Ryot Warm Library
description: A warm, calm, compact design system for Ryot's cross-platform personal tracker.
colors:
  primary: "#FD7E14"
  on-primary: "#2C1A09"
  light-background: "#F5F2EC"
  light-surface: "#FFFDF9"
  light-raised: "#FFFFFF"
  light-surface-muted: "#EFE9DF"
  light-text: "#241F18"
  light-text-muted: "#6A6155"
  light-text-subtle: "#756B5E"
  light-border: "#E6DED1"
  light-border-strong: "#D6CBB9"
  light-accent-text: "#A24E08"
  light-accent-soft: "#FBE7D0"
  light-accent-border: "#F3C99B"
  light-danger: "#A8422E"
  light-success: "#3D6D2F"
  light-success-soft: "#E3ECDB"
  light-info: "#3A6389"
  light-info-soft: "#E0E8EF"
  dark-background: "#101113"
  dark-surface: "#18191C"
  dark-raised: "#1B1D20"
  dark-surface-muted: "#212327"
  dark-text: "#EEECE7"
  dark-text-muted: "#A3A09A"
  dark-text-subtle: "#88857F"
  dark-border: "#2A2C31"
  dark-border-strong: "#3E4147"
  dark-accent-text: "#F5A75F"
  dark-accent-soft: "#31241A"
  dark-accent-border: "#4D3820"
  dark-danger: "#E07A63"
  dark-success: "#8BC276"
  dark-success-soft: "#20291C"
  dark-info: "#85B0D6"
  dark-info-soft: "#1E2833"
typography:
  display-lg:
    fontFamily: Lora
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.2
  heading-lg:
    fontFamily: Lora
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.33
  heading-md:
    fontFamily: Lora
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
  title-lg:
    fontFamily: Outfit
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.3
  title-md:
    fontFamily: Outfit
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.4
  body-lg:
    fontFamily: Outfit
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-md:
    fontFamily: Outfit
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
  label-md:
    fontFamily: Outfit
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.25
  caption:
    fontFamily: Outfit
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
  overline:
    fontFamily: Outfit
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0.08em
spacing:
  xxs: 2px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  2xl: 20px
  3xl: 24px
  4xl: 32px
  5xl: 40px
  6xl: 48px
rounded:
  sm: 6px
  md: 10px
  lg: 12px
  xl: 16px
  full: 999px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    height: 40px
    padding: 12px 16px
  button-secondary:
    backgroundColor: transparent
    textColor: "{colors.light-text}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    height: 40px
    padding: 12px 16px
  button-secondary-dark:
    backgroundColor: transparent
    textColor: "{colors.dark-text}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    height: 40px
    padding: 12px 16px
  input:
    backgroundColor: "{colors.light-raised}"
    textColor: "{colors.light-text}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 12px 16px
  input-dark:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-text}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 12px 16px
  card:
    backgroundColor: "{colors.light-surface}"
    rounded: "{rounded.xl}"
    padding: 24px
  card-dark:
    backgroundColor: "{colors.dark-surface}"
    rounded: "{rounded.xl}"
    padding: 24px
  navigation-row:
    backgroundColor: transparent
    textColor: "{colors.light-text-muted}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 0px 10px
  navigation-row-dark:
    backgroundColor: transparent
    textColor: "{colors.dark-text-muted}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 0px 10px
  bottom-sheet:
    backgroundColor: "{colors.light-surface}"
    rounded: "{rounded.xl}"
    padding: 8px 16px 16px
  bottom-sheet-dark:
    backgroundColor: "{colors.dark-surface}"
    rounded: "{rounded.xl}"
    padding: 8px 16px 16px
  focus-ring:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    width: 2px
---

# Ryot App Client Design System

## Overview

Ryot is a self-hosted personal tracker for books, films, shows, games, fitness, and other parts of a person's life. The interface should feel like a well-kept private library: warm, quiet, useful, and personal. It must not feel like an analytics dashboard, social feed, or generic SaaS admin panel.

The product runs on web, iOS, and Android. Keep information compact and easy to scan on every surface while giving touch interfaces enough room to operate. Favor clear hierarchy, familiar controls, and content imagery over decorative chrome. Motion should explain state or continuity, never perform for its own sake.

Accessibility is part of the visual system. Maintain WCAG AA contrast, preserve platform safe areas, expose control state, support keyboard and screen-reader use, and provide a visible focus treatment on web.

## Colors

The light theme uses warm parchment neutrals instead of pure gray. The dark theme uses neutral charcoal surfaces so the orange accent and media artwork retain their character. Theme selection can follow the system or be set explicitly.

- **Primary orange (`#FD7E14`):** The brand color and main action color. Reserve solid orange for the most important available action, selected switches, and concise highlights.
- **Background:** Use warm linen `#F5F2EC` in light mode and near-black `#101113` in dark mode for the page canvas.
- **Surface:** Use `#FFFDF9` light or `#18191C` dark for navigation, sheets, rows, and grouped content. Use raised and muted surface tokens to separate controls without adding heavy shadows.
- **Text:** Use the main text token for titles and primary values, muted text for metadata and descriptions, and subtle text for overlines, counts, hints, and inactive icons.
- **Borders:** Use the standard border for dividers and containers. Use the strong border only when a control needs clearer separation from its surroundings.
- **Semantic colors:** Danger is for destructive actions and errors, success is for confirmed states, and info is for neutral notices. Do not use these colors as decoration.

On dark surfaces, use the corresponding `dark-*` token rather than mechanically inverting a light value. The primary orange and its dark ink remain constant across themes; supporting accent, text, border, and status colors change to preserve contrast.

For navigation overlays, use `rgb(36 31 24 / 40%)` in light mode and `rgb(8 9 11 / 72%)` in dark mode. Selected navigation rows use a low-contrast text-colored wash: 15% dark ink in light mode or 20% white in dark mode.

## Typography

Use **Outfit** for the interface and **Lora** for editorial hierarchy. This pairing keeps dense controls legible while giving personal collections a warmer, bookish voice.

- **Lora:** Use for large page titles, auth headings, sheet titles, and meaningful content section headings. Prefer semibold. Do not use it for controls, tables, metadata, or long utility text.
- **Outfit:** Use for body copy, navigation, controls, list and grid titles, labels, and metadata. Regular, medium, and semibold are the supported weights.
- **Monospace:** Use the platform monospace face only for keyboard shortcuts, compact counts, or similarly technical fragments. It is not a third brand typeface.
- **Overlines:** Use sparingly for section labels and card context. Set them uppercase with increased tracking and the subtle text color.

On mobile, a top-level title may use `display-lg` and collapse to `title-lg` while scrolling. Dense desktop result views can use Outfit for the page title when that improves scanning. Body copy normally uses `body-md` or `body-lg`; long-form detail copy uses the looser `body-lg` rhythm.

## Layout

Use a 4px base rhythm with 2px half-steps only for fine alignment. The normal component gaps are 8px and 12px; page and card padding are usually 16px or 24px. Compactness should come from a consistent rhythm, not crowded text.

Design mobile-first, then adapt at these Tailwind breakpoints: `sm` 640px, `md` 768px, `lg` 1024px, and `xl` 1280px.

- **Mobile navigation:** Workspace homes and saved views use a drawer. Entity details and settings use stack back navigation. Respect the top and bottom safe areas.
- **Mobile headers:** Use a 54px control row. Show a large Lora title in the scroll content, then transition to a compact 19px Outfit title as it reaches the fixed header.
- **Desktop navigation:** At `md` and above, show a persistent 264px left sidebar. The main content scrolls independently and normally receives 32px top and horizontal padding.
- **Reading width:** Keep settings and prose-heavy detail content centered at a maximum width near 672px. Data views may expand to the available canvas; tables stop near 1152px.
- **Saved-view grid:** Use 2 columns by default, then 3 at `sm`, 4 at `md`, 5 at `lg`, and 6 at `xl`. Keep media at a 3:4 aspect ratio.
- **Saved-view list and table:** Use full-width rows and borders instead of wrapping every record in a card. Align numeric or compact secondary values to the trailing edge.

Prefer responsive utilities and natural layout over runtime width calculations. Preserve search and scroll context while navigating into detail screens. A workspace change may reset that context because it changes the active information space.

## Elevation & Depth

Ryot is mostly flat. Establish hierarchy first with tonal surfaces, one-pixel borders, spacing, and typography. Use shadows only when an element genuinely sits above another layer.

- **Small elevation:** `0 1px 2px rgb(40 30 15 / 5%)` in light mode and `0 1px 2px rgb(0 0 0 / 45%)` in dark mode. Use for selected segmented controls.
- **Card elevation:** `0 1px 2px rgb(40 30 15 / 5%), 0 10px 24px -12px rgb(40 30 15 / 10%)` in light mode. In dark mode use `0 1px 2px rgb(0 0 0 / 40%), 0 14px 28px -14px rgb(0 0 0 / 55%)`.
- **Raised layers:** Auth cards, floating actions, menus, and transient panels may use card elevation. Ordinary saved-view items and settings rows should not.
- **Image tint:** List and table rows may take a restrained gradient tint from their leading artwork. Keep text legible and treat the tint as content context, not decoration.
- **Overlays:** Dim obscured content behind drawers, menus, and customization panels. Do not stack multiple competing elevations.

## Shapes

The shape language is softly rectangular. The 10px and 12px radii are the defaults for controls and rows; 16px is reserved for larger cards and sheets. Use 6px for compact thumbnails or dense controls. Use a full radius for switches, badges, floating actions, and true pill controls.

Media thumbnails follow the same radius scale as their surrounding density. Grid artwork uses 12px corners, while compact list and table thumbnails use 6px. Borders are one pixel and solid. Do not introduce sharp containers, excessive capsules, or ornamental border styles.

## Components

### Buttons And Actions

Primary buttons use solid orange, dark orange ink, semibold Outfit, and a 12px radius. Secondary buttons use a transparent or surface background with a standard or strong border. Tertiary actions are text-only and use accent text or muted text according to importance. Disabled controls keep their geometry and use 50% opacity.

On mobile, primary form actions are normally at least 44px high. Desktop toolbars may use compact 32px or 34px controls. Floating add actions are circular, orange, and limited to the main creation action for the current view.

### Inputs And Selection

Text inputs use a raised surface, standard border, 12px radius, 16px body text, and 12px by 16px internal padding. Error text appears directly below the relevant field in the danger color. Every text input must submit from Enter: intermediate fields advance focus and the last field performs the action.

Segmented controls sit on a muted surface. The selected segment moves to a raised surface with a small shadow. Switches use an orange track when selected and a muted surface when clear. Filter counts and compact statuses may use restrained pills.

### Navigation

Navigation rows are compact, softly rounded, and usually borderless. Inactive labels and icons use muted text; the active label uses primary text and a low-contrast indicator wash. Sidebar section labels use the overline style. Keep edit affordances visible on focus as well as hover.

Use Lucide outline icons through the shared app icon component. Common control icons are 15px to 18px; mobile header icons are 22px to 26px. Icons inherit semantic text colors. Do not mix icon families or use filled icons as decoration.

### Content Collections

Grid cards let artwork lead. Place an optional overline, a two-line title, metadata, and one accent callout below the 3:4 image. Do not add a surrounding card surface unless the content requires grouping.

List rows use a compact leading image, a flexible text stack, and an optional trailing callout. Table rows keep the first column flexible and use fixed, right-aligned secondary columns. Separate list and table rows with standard borders. Every result row or card is one clear link to its entity.

Use a neutral muted surface and the image icon when artwork is missing. Preserve the intended image dimensions so loading and failure do not shift the layout.

### Cards, Sheets, And States

Use bordered surface cards for focused forms and small settings groups, not as a universal page wrapper. Auth cards use a 16px radius, 24px padding, and card elevation. Settings rows use a 12px radius and no shadow.

Bottom sheets use the surface color, a top border, 16px top corners, and a clear Lora title. They may close with a downward pan and must expose dialog title and description semantics.

Loading, empty, not-found, and error states are centered, concise, and stable. Use one title, one muted explanation, and at most one clear recovery action. An empty library may pair a 36px to 40px muted icon with an orange search or add action. Do not expose transport or decoder details.

### Motion And Accessibility

Use short motion only to preserve continuity: header title crossfades, a 6px title translation, a 120ms reorder transition, and a roughly 180ms image-tint entrance. Respect the system reduced-motion setting. Haptics are appropriate for drag pick-up and drop, not every tap.

All interactive elements need an accessible role, label, and state where relevant. Web links and controls use a visible 2px orange focus outline. Never rely on color alone to communicate selection, failure, or completion.

## Do's and Don'ts

- Do make personal content, titles, and artwork the visual focus.
- Do use warm neutrals, restrained borders, and compact spacing to create calm density.
- Do reserve solid orange for the main action or an unambiguous selected state.
- Do use Lora for editorial hierarchy and Outfit for functional interface text.
- Do support light, dark, and system appearance with semantic theme tokens.
- Do preserve safe areas, keyboard operation, focus visibility, screen-reader semantics, and WCAG AA contrast.
- Do use responsive grids, full-width list rows, and aligned tables according to the content task.
- Don't turn every group or record into an elevated card.
- Don't use generic dashboard tiles, social-feed patterns, engagement decoration, or vanity metrics.
- Don't introduce gradients except the restrained artwork-derived tint used in result rows.
- Don't add novelty motion, springy decoration, or haptics without a state or continuity purpose.
- Don't mix icon families, use decorative filled icons, or vary icon size without hierarchy.
- Don't use raw light-theme values in dark mode or expose internal errors to users.
- Don't reduce compact controls below accessible target requirements or hide actions from keyboard users.

<!-- TODO: Remove this file later if not needed anymore -->
