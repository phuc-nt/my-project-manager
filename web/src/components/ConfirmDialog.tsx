// Two-step approve confirm: shows the EXACT (already-redacted) action that will be posted
// before the operator confirms the real POST. The action detail comes from the API, not
// constructed client-side — React only triggers the existing approve endpoint.
import type { ApprovalItem } from '../types'

export function ConfirmDialog({
  item,
  busy,
  onApprove,
  onCancel,
}: {
  item: ApprovalItem
  busy: boolean
  onApprove: () => void
  onCancel: () => void
}) {
  return (
    <div className="confirm-dialog" role="dialog" aria-label="Confirm approval">
      <h3>Confirm approval #{item.id}</h3>
      <p>{item.reason}</p>
      <p>This will execute the following action for real (through the Action Gateway):</p>
      <pre className="action-detail">{JSON.stringify(item.action, null, 2)}</pre>
      <div className="confirm-actions">
        <button type="button" disabled={busy} onClick={onApprove}>
          {busy ? 'Approving…' : 'Approve & post'}
        </button>{' '}
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
