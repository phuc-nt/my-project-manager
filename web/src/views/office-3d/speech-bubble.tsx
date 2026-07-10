// A speech bubble above a desk showing the agent's current task/step title (+ optional M31
// self-check/rework phase tag). Implemented as an HTML overlay (drei's <Html>) which projects
// the given world position to screen space every frame — cheaper and crisper for text than a
// texture-mapped 3D plane. Renders nothing when there is no title. The bubble is a FIXED-width
// frame: long titles are truncated with "…" (CSS ellipsis per line) so bubbles never stretch
// across the scene or overlap their neighbours' desks.
import { Html } from '@react-three/drei'

//: Closed-set phase tag -> short Vietnamese label. Matches `team_task_graph.py`'s
//: PHASE_WORK/PHASE_SELF_CHECK/PHASE_REWORK constants — an unrecognized tag (future
//: phase value not yet wired here) renders nothing rather than the raw code. Exported
//: so it can be unit-tested directly: drei's <Html> needs a live Fiber/Canvas context
//: (see office-scene.test.tsx's note), so this component itself cannot render in
//: jsdom — the label lookup is the part of its logic that can be verified in isolation.
export const PHASE_LABEL: Record<string, string> = {
  'dang-lam': 'đang làm',
  'tu-soat': 'tự soát',
  'dang-sua': 'đang sửa',
}

interface SpeechBubbleProps {
  position: [number, number, number]
  taskTitle: string | null
  stepTitle: string | null
  phase?: string | null
  // M33: the colleague id this desk is currently consulting/being consulted by, or
  // null. Event-driven (`AgentDeskState.consultWith`, see agent-office-state.ts) — no
  // timer here either, this component just renders whatever the reducer currently
  // holds.
  consultWith?: string | null
}

export function SpeechBubble({
  position, taskTitle, stepTitle, phase, consultWith,
}: SpeechBubbleProps) {
  if (!taskTitle && !consultWith) return null
  const phaseLabel = phase ? PHASE_LABEL[phase] : undefined
  return (
    <Html position={position} center distanceFactor={8} occlude={false}>
      <div className="office-3d-bubble">
        {taskTitle && <strong title={taskTitle}>{taskTitle}</strong>}
        {stepTitle && (
          <span className="office-3d-bubble-step" title={stepTitle}>
            {stepTitle}
          </span>
        )}
        {phaseLabel && <span className="office-3d-bubble-phase">{phaseLabel}</span>}
        {consultWith && (
          <span className="office-3d-bubble-consult" title={`Đang tham vấn ${consultWith}`}>
            💬 {consultWith}
          </span>
        )}
      </div>
    </Html>
  )
}
