// Theme state (v10 M24): light / dark / auto, persisted to localStorage['theme'].
// `auto` follows the OS via prefers-color-scheme. The RESOLVED theme (light|dark) is written to
// <html data-theme> so App.css's [data-theme] block and color-scheme apply. The anti-FOUC
// script in index.html runs the same resolution before React mounts — keep the two in sync.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type ThemePref = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeCtx {
  pref: ThemePref
  resolved: ResolvedTheme // what's actually painted — use this as a chart remount key
  setPref: (p: ThemePref) => void
}

const Ctx = createContext<ThemeCtx | null>(null)
const STORAGE_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch {
    /* localStorage may be unavailable (private mode); fall through to default */
  }
  return 'auto'
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches
}

function resolve(pref: ThemePref, sysDark: boolean): ResolvedTheme {
  if (pref === 'auto') return sysDark ? 'dark' : 'light'
  return pref
}

/** Apply the resolved theme to <html> + the theme-color meta. Exported for tests. */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#121212' : '#fafafa')
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [sysDark, setSysDark] = useState<boolean>(systemDark)

  // Track OS changes only while in `auto` (harmless to always listen, cheaper to always listen).
  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY)
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = useMemo(() => resolve(pref, sysDark), [pref, sysDark])

  // Reflect to the DOM whenever the resolved theme changes.
  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p)
    try {
      localStorage.setItem(STORAGE_KEY, p)
    } catch {
      /* persistence is best-effort */
    }
  }, [])

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
