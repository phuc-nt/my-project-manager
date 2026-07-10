// A single agent's desk + mini avatar. The desk outline carries the STATE color; the avatar
// carries the agent's PERSONAL color + one accessory (nón / kính / cà vạt, picked
// deterministically from the agent id) so mỗi nhân sự nhìn khác nhau. The avatar tweens toward
// the desk when the agent transitions to `assigned` (SSE-driven — see office-scene.tsx's state
// map); a thicker desk outline marks `done` (static cue, stays until the next real event). All
// motion is derived from AgentDeskState; there is no animation without a backing transition.
import { useFrame } from '@react-three/fiber'
import { Edges, Html } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'
import type { AgentDeskState } from './agent-office-state'
import { DESK_EDGE_COLOR, agentColor, agentHash } from './desk-colors'
import { SpeechBubble } from './speech-bubble'

const DESK_SIZE: [number, number, number] = [1, 0.5, 0.6]
// Avatar rest spot: just behind the desk when idle/waiting, "at desk" when assigned/working.
const AVATAR_REST_OFFSET: [number, number, number] = [0, 0, 1.4]
const AVATAR_DESK_OFFSET: [number, number, number] = [0, 0, 0.55]
const TWEEN_SPEED = 2.5 // lerp factor — reaches the desk in well under a second

interface AgentDeskProps {
  position: [number, number, number]
  label: string
  desk: AgentDeskState
}

// One low-poly "person": body + head + accessory, all in the agent's personal hue. The
// accessory kind is a stable function of the id so the same staffer always wears the same
// thing: 0 = nón (cone hat), 1 = kính (visor bar), 2 = cà vạt (tie).
function AgentAvatar({ id }: { id: string }) {
  const color = agentColor(id)
  const accessory = agentHash(id) % 3
  return (
    <group>
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[0.3, 0.44, 0.2]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} />
        <Edges color={color} lineWidth={1.8} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} />
        <Edges color={color} lineWidth={1.2} />
      </mesh>
      {accessory === 0 && (
        <mesh position={[0, 0.76, 0]}>
          <coneGeometry args={[0.19, 0.14, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} />
          <Edges color={color} lineWidth={1.4} />
        </mesh>
      )}
      {accessory === 1 && (
        <mesh position={[0, 0.62, 0.12]}>
          <boxGeometry args={[0.26, 0.06, 0.04]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} />
          <Edges color={color} lineWidth={1.4} />
        </mesh>
      )}
      {accessory === 2 && (
        <mesh position={[0, 0.3, 0.11]}>
          <boxGeometry args={[0.07, 0.2, 0.02]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
          <Edges color={color} lineWidth={1.2} />
        </mesh>
      )}
    </group>
  )
}

export function AgentDesk({ position, label, desk }: AgentDeskProps) {
  const avatarRef = useRef<THREE.Group>(null)
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
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
          <Edges color={edgeColor} lineWidth={desk.state === 'done' ? 3 : 1.5} />
        </mesh>
      </group>
      <group
        ref={avatarRef}
        position={[
          position[0] + AVATAR_REST_OFFSET[0],
          position[1] + AVATAR_REST_OFFSET[1],
          position[2] + AVATAR_REST_OFFSET[2],
        ]}
      >
        <AgentAvatar id={label} />
      </group>
      <Html position={[position[0], position[1] + 1.1, position[2]]} center distanceFactor={10} occlude={false}>
        <div className="office-3d-label" style={{ color: agentColor(label) }}>{label}</div>
      </Html>
      <SpeechBubble
        position={bubblePosition}
        taskTitle={desk.taskTitle}
        stepTitle={desk.stepTitle}
        phase={desk.phase}
        consultWith={desk.consultWith}
      />
    </group>
  )
}
