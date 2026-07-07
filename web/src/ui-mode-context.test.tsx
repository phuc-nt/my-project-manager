// v10 M25: ui-mode (low/high) default + persistence.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { UiModeProvider, useUiMode } from './ui-mode-context'

function installLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  })
}

function Probe() {
  const { mode, isHigh, setMode } = useUiMode()
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="isHigh">{String(isHigh)}</span>
      <button type="button" onClick={() => setMode('high')}>
        go-high
      </button>
    </div>
  )
}

beforeEach(() => installLocalStorage())
afterEach(() => vi.unstubAllGlobals())

test('defaults to low', () => {
  render(
    <UiModeProvider>
      <Probe />
    </UiModeProvider>,
  )
  expect(screen.getByTestId('mode')).toHaveTextContent('low')
  expect(screen.getByTestId('isHigh')).toHaveTextContent('false')
})

test('setMode persists to localStorage and flips isHigh', () => {
  render(
    <UiModeProvider>
      <Probe />
    </UiModeProvider>,
  )
  fireEvent.click(screen.getByText('go-high'))
  expect(screen.getByTestId('mode')).toHaveTextContent('high')
  expect(screen.getByTestId('isHigh')).toHaveTextContent('true')
  expect(localStorage.getItem('ui-mode')).toBe('high')
})

test('reads persisted high mode on mount', () => {
  localStorage.setItem('ui-mode', 'high')
  render(
    <UiModeProvider>
      <Probe />
    </UiModeProvider>,
  )
  expect(screen.getByTestId('mode')).toHaveTextContent('high')
})
