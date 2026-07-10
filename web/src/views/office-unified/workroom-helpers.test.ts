// v16 pure helpers: roster filter (ring computed over VISIBLE list) + feed status class.
import { expect, test } from 'vitest'
import type { OfficeMessage } from '../../types'
import { visibleDesks } from '../office-3d/office-canvas'
import { feedStatusClass } from './activity-feed'

function msg(kind: OfficeMessage['kind'], body: OfficeMessage['body']): OfficeMessage {
  return { seq: 1, ts: 't', author: 'x', kind, body }
}

test('visibleDesks filters ghosts and keeps order; null roster = no filtering', () => {
  expect(visibleDesks(['a', 'ghost', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b'])
  expect(visibleDesks(['a', 'ghost'], null)).toEqual(['a', 'ghost'])
})

test('feedStatusClass maps kinds/statuses onto token classes', () => {
  expect(feedStatusClass(msg('handoff', {}))).toBe('ok')
  expect(feedStatusClass(msg('review', { verdict: 'passed' }))).toBe('ok')
  expect(feedStatusClass(msg('review', { verdict: 'needs_rework' }))).toBe('danger')
  expect(feedStatusClass(msg('step_status', { status: 'failed' }))).toBe('danger')
  expect(feedStatusClass(msg('step_status', { status: 'started', phase: 'nho-tro-giup' }))).toBe('pending')
  expect(feedStatusClass(msg('step_status', { status: 'started' }))).toBe('warn')
  expect(feedStatusClass(msg('milestone', { milestone: 'done' }))).toBe('ok')
  expect(feedStatusClass(msg('ceo', {}))).toBe('neutral')
})
