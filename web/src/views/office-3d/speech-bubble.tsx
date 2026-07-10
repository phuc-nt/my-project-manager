// A speech bubble above a desk showing the agent's current task/step title. Implemented as an
// HTML overlay (drei's <Html>) which projects the given world position to screen space every
// frame — cheaper and crisper for text than a texture-mapped 3D plane. Renders nothing when
// there is no title (no bubble for an idle desk with no assigned task).
import { Html } from '@react-three/drei'

interface SpeechBubbleProps {
  position: [number, number, number]
  taskTitle: string | null
  stepTitle: string | null
}

export function SpeechBubble({ position, taskTitle, stepTitle }: SpeechBubbleProps) {
  if (!taskTitle) return null
  return (
    <Html position={position} center distanceFactor={8} occlude={false}>
      <div className="office-3d-bubble">
        <strong>{taskTitle}</strong>
        {stepTitle && <span className="office-3d-bubble-step">{stepTitle}</span>}
      </div>
    </Html>
  )
}
