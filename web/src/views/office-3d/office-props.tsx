// Static office furniture (v14 "living office"): potted plants, a whiteboard, a sofa and
// a floor lamp — pure decoration in the same low-poly wireframe language as the desks
// (translucent fill + Edges outline). No state, no animation: props never react to the
// SSE stream, so they live in their own module and office-scene.tsx just drops
// <OfficeProps /> into the Canvas. Positions sit OUTSIDE the desk ring (RING_RADIUS=4,
// floor 16×12 — see desk-layout.ts / office-floor.tsx) so they never collide with a desk
// however many agents appear.
import { Edges } from '@react-three/drei'

const PLANT_POT_COLOR = '#b07050'
const PLANT_LEAF_COLOR = '#4c9a5f'
const BOARD_FRAME_COLOR = '#8a8a8a'
const SOFA_COLOR = '#5b7fb4'
const LAMP_COLOR = '#c9a34e'

function PottedPlant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.22, 0.16, 0.4, 8]} />
        <meshBasicMaterial color={PLANT_POT_COLOR} transparent opacity={0.2} />
        <Edges color={PLANT_POT_COLOR} lineWidth={1.2} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <sphereGeometry args={[0.3, 8, 6]} />
        <meshBasicMaterial color={PLANT_LEAF_COLOR} transparent opacity={0.16} />
        <Edges color={PLANT_LEAF_COLOR} lineWidth={1.2} />
      </mesh>
      <mesh position={[0, 0.95, 0]}>
        <coneGeometry args={[0.2, 0.35, 7]} />
        <meshBasicMaterial color={PLANT_LEAF_COLOR} transparent opacity={0.16} />
        <Edges color={PLANT_LEAF_COLOR} lineWidth={1.2} />
      </mesh>
    </group>
  )
}

// Whiteboard on two legs, standing against the back wall (-z edge of the floor),
// facing the room center.
function Whiteboard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, 0.55, 0]}>
          <boxGeometry args={[0.06, 1.1, 0.06]} />
          <meshBasicMaterial color={BOARD_FRAME_COLOR} transparent opacity={0.3} />
          <Edges color={BOARD_FRAME_COLOR} lineWidth={1.2} />
        </mesh>
      ))}
      <mesh position={[0, 1.15, 0]}>
        <boxGeometry args={[2, 1.1, 0.05]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.75} />
        <Edges color={BOARD_FRAME_COLOR} lineWidth={1.6} />
      </mesh>
      {/* a few "written" strokes so the board reads as in-use, not blank */}
      {[0.35, 0.15, -0.05].map((y, i) => (
        <mesh key={y} position={[-0.25 + i * 0.1, 1.15 + y, 0.035]}>
          <boxGeometry args={[1.1 - i * 0.3, 0.03, 0.01]} />
          <meshBasicMaterial color={BOARD_FRAME_COLOR} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function Sofa({ position, rotationY }: { position: [number, number, number]; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[1.8, 0.35, 0.7]} />
        <meshBasicMaterial color={SOFA_COLOR} transparent opacity={0.16} />
        <Edges color={SOFA_COLOR} lineWidth={1.4} />
      </mesh>
      <mesh position={[0, 0.62, -0.28]}>
        <boxGeometry args={[1.8, 0.5, 0.14]} />
        <meshBasicMaterial color={SOFA_COLOR} transparent opacity={0.16} />
        <Edges color={SOFA_COLOR} lineWidth={1.4} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0.45, 0]}>
          <boxGeometry args={[0.12, 0.35, 0.7]} />
          <meshBasicMaterial color={SOFA_COLOR} transparent opacity={0.16} />
          <Edges color={SOFA_COLOR} lineWidth={1.2} />
        </mesh>
      ))}
    </group>
  )
}

function FloorLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.4, 6]} />
        <meshBasicMaterial color={LAMP_COLOR} transparent opacity={0.4} />
        <Edges color={LAMP_COLOR} lineWidth={1.2} />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <coneGeometry args={[0.28, 0.3, 8, 1, true]} />
        <meshBasicMaterial color={LAMP_COLOR} transparent opacity={0.25} />
        <Edges color={LAMP_COLOR} lineWidth={1.4} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.05, 8]} />
        <meshBasicMaterial color={LAMP_COLOR} transparent opacity={0.3} />
        <Edges color={LAMP_COLOR} lineWidth={1.2} />
      </mesh>
    </group>
  )
}

export function OfficeProps() {
  return (
    <group>
      <PottedPlant position={[-7, 0, -5]} />
      <PottedPlant position={[7, 0, 4.6]} />
      <Whiteboard position={[-4.5, 0, -5.6]} />
      <Sofa position={[6.6, 0, -3.6]} rotationY={-Math.PI / 2} />
      <FloorLamp position={[7.2, 0, -5.2]} />
    </group>
  )
}
