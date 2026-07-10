// Shared line rendering (v15): the assignment PIC suffix must appear when the body
// carries `pic` but never duplicate a backend summary that already leads with it.
import { expect, test } from 'vitest'
import type { OfficeMessage } from '../../types'
import { messageLine } from './office-message-line'

function msg(kind: OfficeMessage['kind'], body: OfficeMessage['body']): OfficeMessage {
  return { seq: 1, ts: 't', author: 'coordinator', kind, body }
}

test('assignment with pic appends the PIC suffix', () => {
  const line = messageLine(msg('assignment', {
    task_title: 'Ra mắt', summary: 'Phân công: a, b', step_count: 3, pic: 'noi-dung',
  }))
  expect(line).toBe('Ra mắt — Phân công: a, b (3 bước) — PIC: noi-dung')
})

test('assignment whose summary already leads with PIC does not duplicate it', () => {
  const line = messageLine(msg('assignment', {
    task_title: 'Ra mắt', summary: 'PIC: noi-dung — Phân công: a, b', step_count: 3,
    pic: 'noi-dung',
  }))
  expect(line).toBe('Ra mắt — PIC: noi-dung — Phân công: a, b (3 bước)')
})

test('assignment without pic renders exactly the pre-v15 line', () => {
  const line = messageLine(msg('assignment', {
    task_title: 'Ra mắt', summary: 'Phân công: a', step_count: 2,
  }))
  expect(line).toBe('Ra mắt — Phân công: a (2 bước)')
})

test('recover phase renders its label via the shared PHASE_LABEL', () => {
  const line = messageLine(msg('step_status', {
    task_title: 'T', step_title: 'S', status: 'started', phase: 'nho-tro-giup',
  }))
  expect(line).toContain('(nhờ trợ giúp)')
})
