// A single agent's desk: low-poly wireframe box + an "avatar" marker that tweens toward the
// desk position when the agent transitions to `assigned` (SSE-driven — see office-scene.tsx's
// state map), and shows a thicker edge outline while `done` (a static visual cue, not a
// time-based glow/fade — it stays until the next real event moves the desk to a different
// state; see agent-office-state.ts's `nextState`). All motion is derived from AgentDeskState;
// there is no animation without a backing state transition (phase requirement).
import { useFrame } from '@react-three/fiber'
import { Edges, Html } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'
import type { AgentDeskState } from './agent-office-state'
import { DESK_EDGE_COLOR } from './desk-colors'
import { SpeechBubble } from './speech-bubble'

const DESK_SIZE: [number, number, number] = [1, 0.5, 0.6]
const AVATAR_SIZE: [number, number, number] = [0.3, 0.3, 0.3]
// Avatar rest spot: just behind the desk when idle/waiting, "at desk" when assigned/working.
const AVATAR_REST_OFFSET: [number, number, number] = [0, 0.9, 1.4]
const AVATAR_DESK_OFFSET: [number, number, number] = [0, 0.9, 0.5]
const TWEEN_SPEED = 2.5 // units/sec-ish lerp factor — reaches the desk in well under a second

interface AgentDeskProps {
  position: [number, number, number]
  label: string
  desk: AgentDeskState
}

export function AgentDesk({ position, label, desk }: AgentDeskProps) {
  const avatarRef = useRef<THREE.Mesh>(null)
  const targetOffset =
    desk.state === 'assigned' || desk.state === 'working' || desk.state === 'done'
      ? AVATAR_DESK_OFFSET
      : AVATAR_REST_OFFSET

  useFrame((_state, delta) => {
    const avatar = avatarRef.current
    if (!avatar) return
    const targetX = position[0] + targetOffset[0]
    const targetY = position[1] + targetOffset[1]
    const targetZ = position[2] + targetOffset[2]
    const t = Math.min(1, delta * TWEEN_SPEED)
    avatar.position.x += (targetX - avatar.position.x) * t
    avatar.position.y += (targetY - avatar.position.y) * t
    avatar.position.z += (targetZ - avatar.position.z) * t
  })

  const edgeColor = DESK_EDGE_COLOR[desk.state]
  const bubblePosition: [number, number, number] = [position[0], position[1] + 1.6, position[2]]

  return (
    <group>
      <group position={position}>
        <mesh position={[0, 0.25, 0]}>
          <boxGeometry args={DESK_SIZE} />
          <meshBasicMaterial color="#000000" transparent opacity={0} />
          <Edges color={edgeColor} lineWidth={desk.state === 'done' ? 3 : 1.5} />
        </mesh>
      </group>
      <mesh
        ref={avatarRef}
        position={[position[0] + AVATAR_REST_OFFSET[0], position[1] + AVATAR_REST_OFFSET[1], position[2] + AVATAR_REST_OFFSET[2]]}
      >
        <boxGeometry args={AVATAR_SIZE} />
        <meshBasicMaterial color="#000000" transparent opacity={0} />
        <Edges color={edgeColor} lineWidth={2} />
      </mesh>
      <Html position={[position[0], position[1] + 1.1, position[2]]} center distanceFactor={10} occlude={false}>
        <div className="office-3d-label">{label}</div>
      </Html>
      <SpeechBubble position={bubblePosition} taskTitle={desk.taskTitle} stepTitle={desk.stepTitle} />
    </group>
  )
}
