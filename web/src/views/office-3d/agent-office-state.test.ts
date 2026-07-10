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
      phase: null,
      attemptId: null,
      consultWith: null,
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
      phase: null,
      attemptId: null,
      consultWith: null,
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

  test('a phase event (work/self_check/rework) keeps state=working and exposes phase text', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { status: 'started', assigned_to: 'agent-a', task_title: 'Demo', step_title: 'draft' },
      }),
      msg({
        kind: 'step_status', author: 'agent-a',
        body: { status: 'started', assigned_to: 'agent-a', phase: 'tu-soat', attempt_id: 'att-1' },
      }),
    ])
    const desk = desks.get('agent-a')
    expect(desk?.state).toBe('working')
    expect(desk?.phase).toBe('tu-soat')
    expect(desk?.attemptId).toBe('att-1')
  })

  test('a stale attempt id phase event is dropped (zombie-attempt guard)', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { status: 'started', assigned_to: 'agent-a' },
      }),
      msg({
        kind: 'step_status', author: 'agent-a',
        body: { status: 'started', assigned_to: 'agent-a', phase: 'dang-lam', attempt_id: 'att-1' },
      }),
      // A late-arriving event from a SUPERSEDED attempt (e.g. reconnect-replay
      // reordering) must not overwrite the current attempt's phase.
      msg({
        kind: 'step_status', author: 'agent-a',
        body: { status: 'started', assigned_to: 'agent-a', phase: 'dang-sua', attempt_id: 'att-0' },
      }),
    ])
    const desk = desks.get('agent-a')
    expect(desk?.phase).toBe('dang-lam')
    expect(desk?.attemptId).toBe('att-1')
  })

  test('a fresh dispatch (no attempt_id) after a prior attempt resets phase and adopts the new attempt id', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'agent-a',
        body: { status: 'started', assigned_to: 'agent-a', phase: 'dang-sua', attempt_id: 'att-1' },
      }),
      // The ticker's own re-dispatch (retry) carries no attempt_id — it starts a NEW
      // attempt's window, so the OLD phase text must not linger.
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { status: 'started', assigned_to: 'agent-a' },
      }),
      msg({
        kind: 'step_status', author: 'agent-a',
        body: { status: 'started', assigned_to: 'agent-a', phase: 'dang-lam', attempt_id: 'att-2' },
      }),
    ])
    const desk = desks.get('agent-a')
    expect(desk?.phase).toBe('dang-lam')
    expect(desk?.attemptId).toBe('att-2')
  })

  test('a consult event sets consultWith on BOTH the asker and the colleague desks', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'consult', author: 'agent-a', body: { from: 'agent-a', to: 'agent-b' } }),
    ])
    expect(desks.get('agent-a')?.consultWith).toBe('agent-b')
    expect(desks.get('agent-b')?.consultWith).toBe('agent-a')
  })

  test('a consult event does not change state/taskTitle/stepTitle — advisory only', () => {
    const desks = deriveAgentDesks([
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { task_title: 'Demo', step_title: 'draft', status: 'started', assigned_to: 'agent-a' },
      }),
      msg({ kind: 'consult', author: 'agent-a', body: { from: 'agent-a', to: 'agent-b' } }),
    ])
    const desk = desks.get('agent-a')
    expect(desk?.state).toBe('working')
    expect(desk?.taskTitle).toBe('Demo')
    expect(desk?.consultWith).toBe('agent-b')
  })

  test('a desk\'s own NEXT event (any kind) clears its consultWith — event-driven, no timer', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'consult', author: 'agent-a', body: { from: 'agent-a', to: 'agent-b' } }),
      msg({
        kind: 'step_status', author: 'coordinator',
        body: { status: 'started', assigned_to: 'agent-a' },
      }),
    ])
    expect(desks.get('agent-a')?.consultWith).toBeNull()
    // agent-b's own bubble is untouched — only the desk that got a NEW event clears.
    expect(desks.get('agent-b')?.consultWith).toBe('agent-a')
  })

  test('a handoff event also clears a stale consultWith on that desk', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'consult', author: 'agent-a', body: { from: 'agent-a', to: 'agent-b' } }),
      msg({ kind: 'handoff', author: 'agent-a', body: { assigned_to: 'agent-a', message: 'xong' } }),
    ])
    expect(desks.get('agent-a')?.consultWith).toBeNull()
  })

  test('a consult event with a missing from/to is defensive (updates only the present side)', () => {
    const desks = deriveAgentDesks([
      msg({ kind: 'consult', author: 'agent-a', body: { from: 'agent-a' } }),
    ])
    expect(desks.get('agent-a')?.consultWith).toBeNull()
    expect(desks.has('agent-b')).toBe(false)
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

  test('a consult event contributes both from and to ids', () => {
    const ids = agentIdsInOrder([
      msg({ kind: 'consult', author: 'agent-a', body: { from: 'agent-a', to: 'agent-b' } }),
    ])
    expect(ids).toEqual(['agent-a', 'agent-b'])
  })
})
