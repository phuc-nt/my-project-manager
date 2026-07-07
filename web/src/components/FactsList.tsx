// Remembered facts list (internal-only payload from /api/memory). Shows a clear notice
// when there are no facts rather than fabricating any.
import type { Fact } from '../types'

export function FactsList({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) {
    return (
      <p className="muted">Chưa ghi nhớ điều gì (chỉ nội bộ; trống khi tiến trình vừa khởi động).</p>
    )
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
