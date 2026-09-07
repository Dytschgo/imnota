# Imnota design system

This document describes the application's existing visual foundation. `src/renderer/styles.css` is the implementation source of truth. Extend it through semantic tokens and established component patterns; this is not a brand-redesign brief.

## Visual direction

Imnota is a focused desktop workbench: quiet dark or light surfaces, indigo interaction color, compact controls and enough contrast to keep screenshots and annotations dominant. It should feel like a native developer tool, not a marketing site or a themed code editor.

- Variance: restrained. Use hierarchy, spacing and state rather than decorative novelty.
- Motion: subtle and functional. Prefer 120–200 ms state transitions; respect reduced motion.
- Density: compact but readable for repeated screenshot work.
- Target: desktop and laptop, with the smallest fully usable layout aimed at a 13-inch laptop. Phone and tablet layouts are out of scope.

## Typography

Use the existing local/system UI stack:

```css
font-family:
  Inter,
  Geist,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  'Segoe UI',
  sans-serif;
```

Inter and Geist are optional locally available faces, not required web downloads. System fonts keep the desktop application fast and platform-appropriate. Use weight and size for hierarchy; do not introduce a separate monospace heading identity.

Body copy defaults to 14 px. Labels and dense metadata may be smaller when contrast and legibility remain clear. User-entered Markdown and screenshot titles should not be forced to uppercase.

## Core color tokens

Dark is the current explicit base theme. Light uses the same semantic hierarchy. The application may follow the operating-system preference by default.

| Role                    | Dark      | Light     | Token            |
| ----------------------- | --------- | --------- | ---------------- |
| App background          | `#0b0d12` | `#f5f6f8` | `--bg`           |
| Primary surface         | `#12151c` | `#ffffff` | `--surface`      |
| Secondary surface       | `#191d27` | `#f0f1f4` | `--surface-2`    |
| Raised/selected surface | `#202532` | `#e8eaf0` | `--surface-3`    |
| Input surface           | `#0f1218` | `#f9fafb` | `--input`        |
| Primary text            | `#f4f5f7` | `#17191f` | `--ink`          |
| Secondary text          | `#b3bac8` | `#656b78` | `--ink-2`        |
| Muted text              | `#7d8595` | `#7d8491` | `--ink-3`        |
| Faint text              | `#545d6e` | `#a8afbb` | `--ink-4`        |
| Action/focus            | `#6857f5` | `#6857f5` | `--indigo`       |
| Strong focus            | `#8b7cf6` | `#8b7cf6` | `--indigo-light` |
| Informational accent    | `#3ec6e0` | `#3ec6e0` | `--cyan`         |
| Success                 | `#22c55e` | `#22c55e` | `--success`      |
| Warning                 | `#f59e0b` | `#f59e0b` | `--warning`      |
| Destructive             | `#ef4444` | `#ef4444` | `--danger`       |

Borders use low-opacity ink through `--line` and `--line-strong`. Shadows are broad and quiet (`--shadow`) and should be reserved for menus, dialogs and meaningful elevation.

Curated Graphite, Indigo, Emerald, Amber and Glass presets extend these semantic roles; they do not replace component-level colors ad hoc. Glass is cosmetic, has a solid fallback and must reduce or disable transparency for low-performance systems and reduced-transparency preferences.

## Layout and hierarchy

The shell is a desktop workspace with side navigation, a collection rail, the canvas and an inspector. The canvas gets remaining space when a panel collapses. Panels become usable drawers where width is constrained; controls must not simply disappear.

- Keep the macOS traffic-light safe area and draggable title region clear.
- Use consistent 4, 8, 12, 16, 24 and 32 px spacing steps.
- Keep rails compact and scroll long screenshot lists inside their region.
- Make the active collection, active screenshot and active annotation tool unambiguous.
- Muted/excluded screenshot rows remain readable and selectable.
- Dialog actions should place the most common current-collection prompt copies first and fallbacks nearby.

## Components and states

Buttons use indigo for the primary action, semantic colors for status/destructive actions and neutral surfaces for secondary actions. Hover must not shift layout. Icon-only buttons use Lucide icons and visible tooltips; do not use emoji as interface icons.

Inputs and text areas use `--input`, a subtle border and an indigo focus ring. Focus is always visible for keyboard navigation. Disabled controls remain identifiable and use `not-allowed` cursor behavior.

Cards and rows communicate selection with surface and border changes, not scale effects. Use badges sparingly for archived, conflict, priority and Note references. Error states name the affected screenshot or operation and offer a next action.

Annotation colors and application-theme colors are related but distinct. The live canvas follows semantic annotation defaults and user palette overrides. Prompt PNG export always renders on white and may adapt annotation colors for contrast without changing persisted intent.

## Motion and accessibility

- Animate only state, focus, panel and progress transitions that improve orientation.
- Avoid scroll-reveal, parallax, ambient glow and decorative looping effects.
- Respect `prefers-reduced-motion` and reduced-transparency preferences.
- Maintain at least WCAG AA text contrast for ordinary text and a clear non-color state cue where practical.
- Preserve full keyboard access, platform-aware shortcuts and conflict explanations.
- Do not hide essential controls behind hover alone; tooltips supplement visible state.

## Pre-delivery checklist

- [ ] Uses semantic tokens from `src/renderer/styles.css` rather than an unrelated palette.
- [ ] Uses the system UI font stack with no required remote font request.
- [ ] Active, hover, focus, disabled, loading, error and empty states are covered.
- [ ] Collection rail and inspector remain usable at the 13-inch laptop target.
- [ ] Light, dark and system-following modes preserve contrast.
- [ ] Glass/preset styling has a solid accessible fallback.
- [ ] Reduced motion/transparency preferences are respected.
- [ ] Lucide icons and tooltips are used consistently; no emoji icons.
- [ ] Prompt previews show the white export surface accurately.
- [ ] No cloud, account or AI-provider affordance is implied by visual copy.
