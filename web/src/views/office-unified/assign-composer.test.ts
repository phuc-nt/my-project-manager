// The composer's @-mention matching (pure helper — the full composer needs a live API,
// covered by the Playwright E2E instead).
import { expect, test } from 'vitest'
import { filterStaffForMention } from './assign-composer'

const STAFF = [
  { id: 'noi-dung', domain: 'office' },
  { id: 'nghien-cuu', domain: 'office' },
  { id: 'kiem-dinh', domain: 'office' },
]

test('bare @ lists @all plus the whole roster', () => {
  const out = filterStaffForMention('@', STAFF)
  expect(out.map((s) => s.id)).toEqual(['all', 'noi-dung', 'nghien-cuu', 'kiem-dinh'])
})

test('partial narrows by prefix first, then substring', () => {
  // prefix matches lead; substring matches (kiem-diNh) follow — both reachable by typing.
  expect(filterStaffForMention('@n', STAFF).map((s) => s.id)).toEqual([
    'noi-dung', 'nghien-cuu', 'kiem-dinh',
  ])
  expect(filterStaffForMention('@dinh', STAFF).map((s) => s.id)).toEqual(['kiem-dinh'])
})

test('no dropdown without a leading @ or once the mention token is complete', () => {
  expect(filterStaffForMention('viết bài', STAFF)).toEqual([])
  expect(filterStaffForMention('@noi-dung viết bài', STAFF)).toEqual([])
})
