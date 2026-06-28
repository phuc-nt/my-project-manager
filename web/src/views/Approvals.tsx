// Approvals ops view: list pending Lớp B proposals → two-step confirm (operator sees EXACTLY
// what posts) → approve (real gateway path) / reject. The confirm detail is the already-redacted
// pending action from the API (no separate confirm endpoint). React never builds/posts the
// action itself — it only triggers the existing approve endpoint.
import { useCallback, useState } from 'react'
import { useAgent } from '../agent-context'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { api } from '../api/client'
import { useAgentData } from '../hooks/use-agent-data'
import type { ApprovalItem, ApprovalsPayload } from '../types'

export function Approvals() {
  const { selected } = useAgent()
  const get = useCallback((id: string) => api.getApprovals(id), [])
  const { data, loading, error } = useAgentData<ApprovalsPayload>(get)
  const [confirming, setConfirming] = useState<ApprovalItem | null>(null)
  const [pending, setPending] = useState<ApprovalItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)

  const rows = pending ?? data?.pending ?? []

  async function run(fn: () => Promise<ApprovalsPayload>) {
    setBusy(true)
    setOpError(null)
    try {
      const res = await fn()
      setPending(res.pending)
      setConfirming(null)
    } catch (e: unknown) {
      setOpError(e instanceof Error ? e.message : 'action failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p>Loading approvals…</p>
  if (error) return <p className="error">Error: {error}</p>

  return (
    <section>
      <h2>Pending approvals (Lớp B)</h2>
      {opError && <p className="error">Error: {opError}</p>}
      {rows.length === 0 ? (
        <p className="muted">No pending approvals.</p>
      ) : (
        <table className="proposals-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Action</th>
              <th>Reason</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>
                  {p.action.type}:{p.action.server}:{p.action.tool}
                </td>
                <td>{p.reason}</td>
                <td>{p.created_at}</td>
                <td>
                  <button type="button" disabled={busy} onClick={() => setConfirming(p)}>
                    Review
                  </button>{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selected && run(() => api.reject(selected, p.id))}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirming && selected && (
        <ConfirmDialog
          item={confirming}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onApprove={() => run(() => api.approve(selected, confirming.id))}
        />
      )}
    </section>
  )
}
