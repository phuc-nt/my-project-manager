// vitest setup: jest-dom matchers for component assertions. Local-only (npm test).
import '@testing-library/jest-dom'

// jsdom ships no matchMedia; the theme provider (v10 M24) reads it. Provide a light-mode default
// so any component that renders the ThemeToggle works without per-test wiring. Tests that need to
// drive the OS preference stub it themselves (see theme-context.test.tsx).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
