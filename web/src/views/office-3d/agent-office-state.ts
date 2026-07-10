// Pure event → state-machine mapping shared by the 3D scene and the 2D fallback table
// (agent-status-table.tsx). Kept dependency-free (no r3f/Canvas) so it is unit-testable in
// plain jsdom, matching the "SSE-driven only" requirement: this is the single place that
// decides what "idle / assigned / working / done" means for an agent, derived ONLY from the
// office room's OfficeMessage stream (no polling, no local-only state).
//
// Desks are keyed by `assigned_to`, NEVER by `author`: the ticker authors a step's `started`
// event as "coordinator" (it is the one dispatching, not the one doing the work) — the
// assignee identity rides in the body's `assigned_to` field instead (see
// `tick_actions.reserve_and_spawn` / `team_step_runner._append_step_event`). Keying by author
// would create a phantom "coordinator" desk that never leaves "working" and would leave real
// agents' desks empty until their first `handoff`.
//
// Real backend status vocabulary (grep `tick_actions.py`/`team_step_runner.py`): a
// `step_status` event's `status` is only ever `started` (ticker, dispatch) or `failed` (worker,
// terminal); a completed step is signaled by the `handoff` KIND, not a `step_status` status
// value — there is no `completed`/`done`/`in_progress` status string in production.
import type { OfficeMessage } from '../../types'

export type AgentState = 'idle' | 'assigned' | 'working' | 'done'

export interface AgentDeskState {
  id: string
  state: AgentState
  taskTitle: string | null
  stepTitle: string | null
}

function nextState(prev: AgentState, status: string | undefined): AgentState {
  switch (status) {
    case 'started':
      return 'working'
    case 'failed':
      // No distinct "error" visual yet (phase scope) — a failed step frees the desk back to
      // idle rather than showing a false "working"/"done"; the office room timeline (not the
      // 3D scene) is the surface for failure detail.
      return 'idle'
    default:
      return prev
  }
}

// Reduces the full ordered event list into a per-agent desk-state map. Pure function — no
// timers, no randomness — so the same event list always yields the same map (a re-render or a
// reconnect-replay is idempotent).
export function deriveAgentDesks(messages: OfficeMessage[]): Map<string, AgentDeskState> {
  const desks = new Map<string, AgentDeskState>()

  const ensure = (id: string): AgentDeskState => {
    let d = desks.get(id)
    if (!d) {
      d = { id, state: 'idle', taskTitle: null, stepTitle: null }
      desks.set(id, d)
    }
    return d
  }

  for (const m of messages) {
    switch (m.kind) {
      case 'assignment': {
        // Task-level (coordinator-authored, no single assignee) — no per-agent desk update.
        break
      }
      case 'step_status': {
        const assignedTo = m.body.assigned_to
        if (!assignedTo) break // defensive: an event missing the field updates no desk
        const d = ensure(assignedTo)
        d.taskTitle = m.body.task_title ?? d.taskTitle
        d.stepTitle = m.body.step_title ?? d.stepTitle
        d.state = nextState(d.state === 'idle' ? 'assigned' : d.state, m.body.status)
        break
      }
      case 'handoff': {
        const assignedTo = m.body.assigned_to ?? m.author
        const d = ensure(assignedTo)
        d.taskTitle = m.body.task_title ?? d.taskTitle
        d.stepTitle = m.body.step_title ?? d.stepTitle
        // A handoff marks the step as delivered to the next person — the desk shows "done"
        // until the SAME agent's next step_status/started moves it back to working.
        d.state = 'done'
        break
      }
      case 'milestone': {
        // Milestones are task-level (coordinator-authored), not desk state — no per-agent desk
        // update needed.
        break
      }
      case 'ceo':
        break
      default:
        break
    }
  }

  return desks
}

// Distinct agent ids seen in the stream, in first-seen order — drives desk layout (grid
// position assignment happens in office-scene.tsx, not here). Uses the SAME `assigned_to`
// keying as deriveAgentDesks (never `author`) so the id list and the desk map always agree.
export function agentIdsInOrder(messages: OfficeMessage[]): string[] {
  const seen: string[] = []
  const set = new Set<string>()
  const add = (id: string | undefined) => {
    if (!id || set.has(id)) return
    set.add(id)
    seen.push(id)
  }
  for (const m of messages) {
    if (m.kind === 'step_status') add(m.body.assigned_to)
    if (m.kind === 'handoff') add(m.body.assigned_to ?? m.author)
  }
  return seen
}
