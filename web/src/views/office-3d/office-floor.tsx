// Static floor + wall wireframe grid — the office "room" shell. Pure geometry, no state; split
// out from office-canvas.tsx to keep that file focused on data wiring. Colors tuned for the
// light canvas background (see desk-colors.ts).
import { Edges } from '@react-three/drei'

const FLOOR_SIZE: [number, number, number] = [16, 0.05, 12]

// v18: two fixed palettes — r3f materials can't read CSS vars, so the theme rides in
// as a prop from the canvas (which watches data-theme).
export function OfficeFloor({ dark = false }: { dark?: boolean }) {
  const wall = dark ? '#4a4a4a' : '#bdbdbd'
  const gridMajor = dark ? '#3a3a3a' : '#d6d6d6'
  const gridMinor = dark ? '#2a2a2a' : '#e7e7e7'
  return (
    <group>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={FLOOR_SIZE} />
        <meshBasicMaterial color={dark ? '#141414' : '#ffffff'} transparent opacity={0} />
        <Edges color={wall} lineWidth={1} />
      </mesh>
      <gridHelper key={dark ? 'dark' : 'light'} args={[16, 16, gridMajor, gridMinor]} position={[0, 0, 0]} />
    </group>
  )
}
