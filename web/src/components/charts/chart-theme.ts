// Chart palette + axis/legend styling read from the live CSS theme tokens (v10 M24). chart.js
// can't see CSS variables, so we resolve them off <html> at render time. This keeps chart colors
// in sync with light/dark without hardcoding hex in the components. M25 remounts charts on theme
// change (key={resolvedTheme}) so these values are re-read when the theme flips.

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Semantic verdict colors, resolved from the status tokens. */
export function verdictColors(): Record<string, string> {
  return {
    allow: token('--color-ok', '#1e7e34'),
    deny: token('--color-danger', '#b00020'),
    pending: token('--color-pending', '#8a6d00'),
    reject: token('--color-danger-strong', '#d93025'),
    dry_run: token('--color-muted', '#6b6b6b'),
    skipped: token('--color-subtle', '#707070'),
  }
}

/** Accent color for series (cost line etc.). */
export function accentColor(): string {
  return token('--color-accent', '#2f6feb')
}

/** Danger color for reference lines (budget cap etc.). */
export function dangerColor(): string {
  return token('--color-danger-strong', '#d93025')
}

/** Neutral fallback for unknown verdict keys. */
export function neutralColor(): string {
  return token('--color-subtle', '#707070')
}

/** Axis tick / grid / legend colors so chart chrome is readable on the current theme. */
export function chartChrome(): { tick: string; grid: string; legend: string } {
  return {
    tick: token('--color-muted', '#6b6b6b'),
    grid: token('--color-border-soft', '#eeeeee'),
    legend: token('--color-text', '#1a1a1a'),
  }
}
