// Pure layout: places N agent desks in a simple ring around the coordinator's center desk. No
// fixed per-agent-id positions (v1 decision from the phase's unresolved-questions section) — the
// grid grows/shrinks with however many distinct agents have appeared in the event stream so far.
const RING_RADIUS = 4

export function deskPosition(index: number, total: number): [number, number, number] {
  if (total <= 0) return [0, 0, RING_RADIUS]
  const angle = (index / total) * Math.PI * 2
  const x = Math.sin(angle) * RING_RADIUS
  const z = Math.cos(angle) * RING_RADIUS
  return [x, 0, z]
}
