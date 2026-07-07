// UI density mode (v10 M25): low (default, CEO-first 4-item nav) vs high ("Chế độ nâng cao",
// unlocks the technical views + denser tables). Persisted to localStorage['ui-mode']. This is a
// VIEW-LAYER preference only — it changes nav density, never permissions. The advanced routes
// stay reachable by direct URL in low mode; auth + the Action Gateway are the real boundaries.
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type UiMode = 'low' | 'high'

interface UiModeCtx {
  mode: UiMode
  isHigh: boolean
  setMode: (m: UiMode) => void
}

const Ctx = createContext<UiModeCtx | null>(null)
const STORAGE_KEY = 'ui-mode'

function readMode(): UiMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'high' ? 'high' : 'low'
  } catch {
    return 'low'
  }
}

export function UiModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<UiMode>(readMode)

  const setMode = useCallback((m: UiMode) => {
    setModeState(m)
    try {
      localStorage.setItem(STORAGE_KEY, m)
    } catch {
      /* persistence is best-effort */
    }
  }, [])

  const value = useMemo(
    () => ({ mode, isHigh: mode === 'high', setMode }),
    [mode, setMode],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUiMode(): UiModeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUiMode must be used within UiModeProvider')
  return ctx
}
