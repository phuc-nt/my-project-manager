// Remembered facts list (internal-only payload from /api/memory). Shows a clear notice
// when there are no facts rather than fabricating any.
import type { Fact } from '../types'

export function FactsList({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) {
    return <p className="muted">No remembered facts (internal-only; empty on a fresh process).</p>
  }
  return (
    <ul className="facts-list">
      {facts.map((f, i) => (
        <li key={f.key ?? i}>
          {f.fact}
          {f.ts ? <span className="muted"> · {f.ts}</span> : null}
        </li>
      ))}
    </ul>
  )
}
