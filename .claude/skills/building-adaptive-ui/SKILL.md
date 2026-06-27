---
name: building-adaptive-ui
description: Build UI that adapts to themes by using design tokens instead of hardcoded colors. Use when writing or reviewing styles, components, or stylesheets.
---

# Building adaptive UI

Adaptive UI responds to the user's theme (light/dark, high-contrast, brand
palettes) instead of baking one appearance in. The rule of thumb: **never write a
literal color**. Reach for a semantic design token (CSS custom property, theme
variable, or design-system token) so a single theme switch restyles everything.

## Guidance

- Use tokens like `var(--color-surface)` or `theme.colors.text.primary`, not
  `#1e1e1e`, `rgb(30, 30, 30)`, or `hsl(...)`.
- Name tokens by role (surface, text, border, accent), not by value (gray-900).
- Derive states (hover, disabled) from the base token, don't hand-pick new hex.
- Keep one source of truth for the palette; components consume, never define.

## Bundled script

`scripts/check-hardcoded-colors.sh <paths...>` greps the given source files for
hardcoded hex / `rgb()` / `hsl()` colors and exits non-zero if any are found, so
it can run as a pre-commit or hook gate.
