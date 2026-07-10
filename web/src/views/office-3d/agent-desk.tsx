// A single agent's desk + mini avatar. The desk outline carries the STATE color; the avatar
// carries the agent's PERSONAL color + one accessory (nón / kính / cà vạt, picked
// deterministically from the agent id) so mỗi nhân sự nhìn khác nhau. The avatar tweens toward
// the desk when the agent transitions to `assigned`, and toward the MEETING POINT between the
// two desks while `consultWith` is set (both SSE-driven — see office-scene.tsx's state map and
// agent-office-state.ts's consult case); a thicker desk outline marks `done` (static cue, stays
// until the next real event). All POSITION TARGETS are derived from AgentDeskState — no target
// change without a backing transition. The one deliberate cosmetic exception (v14 "living
// office") is the idle breathing bob below: a ~1.5cm sinusoidal y-offset that carries NO state
// meaning (same amplitude in every state) and therefore cannot misreport anything.
import { useFrame } from '@react-three/fiber'
import { Edges, Html } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'
import type { AgentDeskState } from './agent-office-state'
import { DESK_EDGE_COLOR, agentColor, agentHash } from './desk-colors'
import { consultMeetPoint } from './desk-layout'
import { SpeechBubble } from './speech-bubble'

const DESK_SIZE: [number, number, number] = [1, 0.5, 0.6]
// Avatar rest spot: just behind the desk when idle/waiting, "at desk" when assigned/working.
const AVATAR_REST_OFFSET: [number, number, number] = [0, 0, 1.4]
const AVATAR_DESK_OFFSET: [number, number, number] = [0, 0, 0.55]
const TWEEN_SPEED = 2.5 // lerp factor — reaches the desk in well under a second
const BOB_AMPLITUDE = 0.015 // breathing bob (cosmetic only — see file header)
const BOB_SPEED = 1.6

interface AgentDeskProps {
  position: [number, number, number]
  label: string
  desk: AgentDeskState
  // Desk position of the colleague this agent is consulting with (from office-scene's
  // id→position map), null when desk.consultWith is unset or the colleague has no desk
  // yet. When set, the avatar walks to consultMeetPoint(own, colleague) instead of its
  // own desk/rest spot — and walks back once the consult bubble clears.
  consultPos: [number, number, number] | null
}

// One low-poly "person": head + body + arms + legs + accessory, all in the agent's personal
// hue. The accessory kind is a stable function of the id so the same staffer always wears the
// same thing: 0 = nón (cone hat), 1 = kính (visor bar), 2 = cà vạt (tie).
function AgentAvatar({ id }: { id: string }) {
  const color = agentColor(id)
  const accessory = agentHash(id) % 3
  return (
    <group>
      {/* legs */}
      {[-0.08, 0.08].map((x) => (
        <mesh key={x} position={[x, 0.11, 0]}>
          <boxGeometry args={[0.09, 0.22, 0.11]} />
          <meshBasicMaterial color={color} transparent opacity={0.14} />
          <Edges color={color} lineWidth={1.4} />
        </mesh>
      ))}
      {/* torso (raised so the legs fit under it) */}
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[0.3, 0.4, 0.2]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} />
        <Edges color={color} lineWidth={1.8} />
      </mesh>
      {/* arms */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.42, 0]}>
          <boxGeometry args={[0.08, 0.34, 0.1]} />
          <meshBasicMaterial color={color} transparent opacity={0.14} />
          <Edges color={color} lineWidth={1.4} />
        </mesh>
      ))}
      <mesh position={[0, 0.76, 0]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} />
        <Edges color={color} lineWidth={1.2} />
      </mesh>
      {accessory === 0 && (
        <mesh position={[0, 0.92, 0]}>
          <coneGeometry args={[0.19, 0.14, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} />
          <Edges color={color} lineWidth={1.4} />
        </mesh>
      )}
      {accessory === 1 && (
        <mesh position={[0, 0.78, 0.12]}>
          <boxGeometry args={[0.26, 0.06, 0.04]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} />
          <Edges color={color} lineWidth={1.4} />
        </mesh>
      )}
      {accessory === 2 && (
        <mesh position={[0, 0.48, 0.11]}>
          <boxGeometry args={[0.07, 0.2, 0.02]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
          <Edges color={color} lineWidth={1.2} />
        </mesh>
      )}
    </group>
  )
}

export function AgentDesk({ position, label, desk, consultPos }: AgentDeskProps) {
  const avatarRef = useRef<THREE.Group>(null)
  const bobRef = useRef<THREE.Group>(null) // inner group: bob rides here, NOT inside the lerp
  const bobPhase = agentHash(label) % 7 // de-sync the bobs so the room doesn't pulse in unison
  const deskOffset =
    desk.state === 'assigned' || desk.state === 'working' || desk.state === 'done'
      ? AVATAR_DESK_OFFSET
      : AVATAR_REST_OFFSET
  // Consult wins over desk/rest: while the consult bubble is live, the avatar stands at
  // the meeting point between the two desks (walking there via the same tween below).
  const target: [number, number, number] = consultPos
    ? consultMeetPoint(position, consultPos)
    : [
        position[0] + deskOffset[0],
        position[1] + deskOffset[1],
        position[2] + deskOffset[2],
      ]

  useFrame((state, delta) => {
    const avatar = avatarRef.current
    if (!avatar) return
    const t = Math.min(1, delta * TWEEN_SPEED)
    avatar.position.x += (target[0] - avatar.position.x) * t
    avatar.position.y += (target[1] - avatar.position.y) * t
    avatar.position.z += (target[2] - avatar.position.z) * t
    // Breathing bob on the INNER group, set absolutely each frame — running it through
    // the lerp above would both damp the amplitude and lag the phase.
    const bob = bobRef.current
    if (bob) {
      bob.position.y = BOB_AMPLITUDE * Math.sin(state.clock.elapsedTime * BOB_SPEED + bobPhase)
    }
    // Face the walk/consult direction on the y-axis only (cosmetic orientation — derived
    // from the same SSE-driven target, no extra state): look at the colleague while
    // consulting, back to the room center (the coordinator) otherwise. The angle delta
    // is wrapped to [-π, π] so the turn always takes the short way around instead of a
    // full-circle spin when the raw difference crosses the ±π seam.
    const [faceX, faceZ] = consultPos ? [consultPos[0], consultPos[2]] : [0, 0]
    const angle = Math.atan2(faceX - avatar.position.x, faceZ - avatar.position.z)
    const rawTurn = angle - avatar.rotation.y
    const shortTurn = Math.atan2(Math.sin(rawTurn), Math.cos(rawTurn))
    avatar.rotation.y += shortTurn * t
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
        <group ref={bobRef}>
          <AgentAvatar id={label} />
        </group>
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
