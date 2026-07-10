// Unit tests for the pure event → desk-state reducer. No Canvas, no r3f — this is the state
// machine the 3D scene AND the 2D fallback table both read from.
//
// Event shapes here match what the backend ACTUALLY emits (grep `tick_actions.py`'s
// `reserve_and_spawn` and `team_step_runner.py`'s `_append_step_event`): `step_status` carries
// `assigned_to` in the body and `author: "coordinator"` for `started`, `author: <agent>` for
// `failed`; `handoff` carries `author: <agent>` (== `assigned_to`). There is no `completed`/
// `done`/`in_progress` status string in production — a completed step is signaled by the
// `handoff` KIND, not a `step_status` status value.
import { describe, expect, test } from 'vitest'
import type { OfficeMessage } from '../../types'
import { agentIdsInOrder, deriveAgentDesks } from './agent-office-state'

function msg(partial: Partial<OfficeMessage> & Pick<OfficeMessage, 'kind' | 'author'>): OfficeMessage {
  return { seq: 1, ts: 't', body: {}, ...partial }
}

describe('deriveAgentDesks', () => {
  test('an empty stream yields no desks', () => {
    expect(deriveAgentDesks([]).size).toBe(0)
  })

  test('step_status started (ticker-authored, assigned_to names the real worker) moves the ASSIGNEE desk to working, not a "coordinator" desk', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { task_title: 'Demo', step_title: 'draft', status: 'started', assigned_to: 'agent-a' },
      }),
    ])
    expect(desks.get('agent-a')).toEqual({
      id: 'agent-a',
      state: 'working',
      taskTitle: 'Demo',
      stepTitle: 'draft',
    })
    expect(desks.has('coordinator')).toBe(false)
  })

  test('a step_status event with no assigned_to updates no desk (defensive, never crashes)', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'step_status', author: 'coordinator', body: { status: 'started' } }),
    ])
    expect(desks.size).toBe(0)
  })

  test('a handoff (worker-authored, done) moves the author desk to done', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { task_title: 'Demo', step_title: 'draft', status: 'started', assigned_to: 'agent-a' },
      }),
      msg({
        kind: 'handoff', author: 'agent-a',
        body: { task_title: 'Demo', step_title: 'draft', message: 'xong', assigned_to: 'agent-a' },
      }),
    ])
    expect(desks.get('agent-a')?.state).toBe('done')
  })

  test('a worker-authored step_status failed frees the desk back to idle', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { task_title: 'Demo', step_title: 'draft', status: 'started', assigned_to: 'agent-a' },
      }),
      msg({
        kind: 'step_status', author: 'agent-a',
        body: { task_title: 'Demo', step_title: 'draft', status: 'failed', assigned_to: 'agent-a' },
      }),
    ])
    expect(desks.get('agent-a')?.state).toBe('idle')
  })

  test('a handoff event marks the assignee desk as done and carries task/step titles', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'handoff', author: 'agent-b',
        body: { task_title: 'Demo', step_title: 'review', message: 'xong', assigned_to: 'agent-b' },
      }),
    ])
    expect(desks.get('agent-b')).toEqual({
      id: 'agent-b',
      state: 'done',
      taskTitle: 'Demo',
      stepTitle: 'review',
    })
  })

  test('a handoff missing assigned_to falls back to author (defensive)', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'handoff', author: 'agent-b', body: { task_title: 'Demo', message: 'xong' } }),
    ])
    expect(desks.get('agent-b')?.state).toBe('done')
  })

  test('milestone and ceo events do not create desks', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'ceo', author: 'ceo', body: { text: 'go' } }),
      msg({ kind: 'milestone', author: 'coordinator', body: { task_title: 'Demo', milestone: 'done' } }),
    ])
    expect(desks.size).toBe(0)
  })

  test('assignment events (task-level, no single assignee) do not create a desk', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'assignment', author: 'coordinator', body: { task_title: 'Demo', step_count: 2, summary: 'a, b' } }),
    ])
    expect(desks.size).toBe(0)
  })

  test('multiple agents each get their own desk, independently tracked', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { task_title: 'T1', step_title: 's1', status: 'started', assigned_to: 'agent-a' },
      }),
      msg({
        kind: 'handoff', author: 'agent-b',
        body: { task_title: 'T2', step_title: 's2', message: 'xong', assigned_to: 'agent-b' },
      }),
    ])
    expect(desks.get('agent-a')?.state).toBe('working')
    expect(desks.get('agent-b')?.state).toBe('done')
  })

  test('a later real event always wins — a started after a handoff moves the desk back to working', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'handoff', author: 'agent-a',
        body: { assigned_to: 'agent-a', message: 'xong' },
      }),
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { status: 'started', assigned_to: 'agent-a' },
      }),
    ])
    expect(desks.get('agent-a')?.state).toBe('working')
  })
})

describe('agentIdsInOrder', () => {
  test('returns distinct agent ids in first-seen order, keyed by assigned_to (never author)', () => {
    const ids = agentIdsInOrder([
      msg({ kind: 'ceo', author: 'ceo' }),
      msg({ kind: 'step_status', author: 'coordinator', body: { status: 'started', assigned_to: 'agent-b' } }),
      msg({ kind: 'step_status', author: 'coordinator', body: { status: 'started', assigned_to: 'agent-a' } }),
      msg({ kind: 'handoff', author: 'agent-b', body: { message: 'xong', assigned_to: 'agent-b' } }),
    ])
    expect(ids).toEqual(['agent-b', 'agent-a'])
  })

  test('an empty stream yields no agent ids', () => {
    expect(agentIdsInOrder([])).toEqual([])
  })
})
