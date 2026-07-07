// Pending Lớp B proposals (read-only here; the approve/reject actions live in the S4 ops
// view). Shows id/reason/status/action_summary — the action is summarized, never raw args.
import { formatDateTime } from '../labels'
import type { Proposal } from '../types'

export function PendingProposals({ pending }: { pending: Proposal[] }) {
  if (pending.length === 0) return <p className="muted">Không có đề xuất chờ duyệt.</p>
  return (
    <div className="table-scroll">
    <table className="proposals-table">
      <thead>
        <tr>
          <th>Mã</th>
          <th>Hành động</th>
          <th>Lý do</th>
          <th>Trạng thái</th>
          <th>Tạo lúc</th>
        </tr>
      </thead>
      <tbody>
        {pending.map((p) => (
          <tr key={p.id}>
            <td>{p.id}</td>
            <td>{p.action_summary}</td>
            <td>{p.reason}</td>
            <td>{p.status}</td>
            <td>{formatDateTime(p.created_at) || p.created_at}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}
