// v10 M24: theme resolution + persistence + OS-follow. jsdom has no matchMedia, so we install a
// controllable stub per test.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ThemeProvider, useTheme } from './theme-context'

type MqStub = {
  matches: boolean
  listeners: ((e: MediaQueryListEvent) => void)[]
}

function installLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  })
}

function installMatchMedia(initialDark: boolean): MqStub {
  const stub: MqStub = { matches: initialDark, listeners: [] }
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? stub.matches : false,
    media: query,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => stub.listeners.push(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      stub.listeners = stub.listeners.filter((l) => l !== cb)
    },
    // legacy no-ops
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }))
  return stub
}

function Probe() {
  const { pref, resolved, setPref } = useTheme()
  return (
    <div>
      <span data-testid="pref">{pref}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setPref('dark')}>
        go-dark
      </button>
      <button type="button" onClick={() => setPref('auto')}>
        go-auto
      </button>
    </div>
  )
}

beforeEach(() => {
  installLocalStorage()
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThemeProvider', () => {
  test('defaults to auto and resolves light when OS is light', () => {
    installMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('pref')).toHaveTextContent('auto')
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('auto resolves dark when OS is dark', () => {
    installMatchMedia(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  test('explicit pref overrides OS and persists to localStorage', () => {
    installMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByText('go-dark'))
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  test('reads persisted pref on mount', () => {
    localStorage.setItem('theme', 'dark')
    installMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('pref')).toHaveTextContent('dark')
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
  })

  test('follows OS change live while in auto', () => {
    const mq = installMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')
    // OS flips to dark → provider listener fires
    mq.matches = true
    act(() => {
      mq.listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent))
    })
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
  })
})
