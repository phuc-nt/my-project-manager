// Team view (route /team): all agents with lifecycle controls (pause/resume, delete) +
// the integration health panel. Statuses (budget, pending approvals) are fetched lazily
// per-agent after the agent list loads, mirroring how other views fetch per-selected-agent
// data via api.getAgentStatus. Delete requires the existing ConfirmDialog-style two-step
// confirm; the `default` agent's Delete action is hidden (backend also 400s it).
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import { IntegrationHealthPanel } from '../components/IntegrationHealthPanel'
import { KIND_LABEL, RUN_STATUS_LABEL, labelFor } from '../labels'
import type { AgentStatus, AgentSummary, TeamAlert } from '../types'

export function Team() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [deletedNote, setDeletedNote] = useState<string | null>(null)
  // agent id -> "profile still disables it" notice after a Resume the profile vetoes
  // (PATCH .../enabled returns effective_enabled=false even though enabled=true).
  const [profileDisabledNotice, setProfileDisabledNotice] = useState<Record<string, boolean>>({})
  // v3 M8: deterministic fleet alerts (budget near cap, stuck approvals, deny spikes).
  const [alerts, setAlerts] = useState<TeamAlert[]>([])
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  // v9 P2: "+ Tạo nhân sự ảo" prefers the conversational path (chat-ops), but a brand-new CEO
  // may have no admin agent / no ops_operator_id yet — chat is then unavailable and would be a
  // dead-end. Fall back to the wizard so the FIRST agent can always be created. (red-team B3)
  const goCreate = useCallback(async () => {
    setCreating(true)
    try {
      const r = await api.opsChatAvailable()
      navigate(r.available ? '/chat?intent=create-agent' : '/create')
    } catch {
      navigate('/create') // availability check failed → wizard still works
    } finally {
      setCreating(false)
    }
  }, [navigate])

  const loadAgents = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getTeamAlerts()
      .then((p) => setAlerts(p.alerts))
      .catch(() => undefined) // alerts are an overlay; their failure must not break the table
    api
      .getAgents()
      .then((list) => {
        setAgents(list)
        for (const a of list) {
          api
            .getAgentStatus(a.id)
            .then((s) => setStatuses((prev) => ({ ...prev, [a.id]: s })))
            .catch(() => undefined) // a single agent's status failing shouldn't break the table
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'không tải được danh sách agent'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  async function toggleEnabled(agent: AgentSummary) {
    setBusyId(agent.id)
    setOpError(null)
    try {
      const res = await api.setAgentEnabled(agent.id, !agent.enabled)
      // Don't trust the optimistic `enabled` value alone — a Resume can flip the
      // registry (enabled: true) while the profile still vetoes the agent
      // (effective_enabled: false). Re-fetch the real list so the table reflects the
      // service gate's actual state, and surface a per-row notice for that case.
      setProfileDisabledNotice((prev) => {
        const next = { ...prev }
        if (res.enabled && !res.effective_enabled) next[agent.id] = true
        else delete next[agent.id]
        return next
      })
      await refreshAgentsOnly()
    } catch (e: unknown) {
      setOpError(e instanceof Error ? e.message : 'thao tác thất bại')
    } finally {
      setBusyId(null)
    }
  }

  async function refreshAgentsOnly() {
    const list = await api.getAgents()
    setAgents(list)
  }

  async function confirmDelete(id: string) {
    setBusyId(id)
    setOpError(null)
    try {
      await api.deleteAgent(id)
      setAgents((prev) => prev.filter((a) => a.id !== id))
      setProfileDisabledNotice((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setConfirmingDelete(null)
      setDeletedNote(`Đã xoá ${id}. Hồ sơ agent được giữ lại để lưu trữ.`)
    } catch (e: unknown) {
      setOpError(e instanceof Error ? e.message : 'xoá thất bại')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section>
      <IntegrationHealthPanel />

      <h2>Đội</h2>
      <div className="team-actions">
        <button type="button" className="btn-link" disabled={creating} onClick={goCreate}>
          + Tạo nhân sự ảo
        </button>
        <Link to="/company-docs" className="btn-link">
          📄 Kho tài liệu
        </Link>
      </div>
      {alerts.length > 0 && (
        <div className="team-alerts" role="alert">
          {alerts.map((al, i) => (
            <p key={i} className={al.severity === 'high' ? 'error' : 'muted'}>
              {al.severity === 'high' ? '🔴' : '🟡'} <strong>{al.agent_id}</strong>: {al.message}
            </p>
          ))}
        </div>
      )}
      {opError && <p className="error">Lỗi: {opError}</p>}
      {deletedNote && <p className="ok">{deletedNote}</p>}
      {loading && <p>Đang tải…</p>}
      {error && <p className="error">Lỗi: {error}</p>}
      {!loading && !error && agents.length === 0 && <p className="muted">Chưa có agent nào.</p>}
      {!loading && !error && agents.length > 0 && (
        <table className="agents-table">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Tên</th>
              <th>Trạng thái</th>
              <th>Lần chạy gần nhất</th>
              <th>Ngân sách</th>
              <th>Chờ duyệt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const status = statuses[a.id]
              return (
                <tr key={a.id}>
                  <td data-label="Mã">
                    <Link to={`/agents/${a.id}`}>{a.id}</Link>
                  </td>
                  <td data-label="Tên">{a.name}</td>
                  <td data-label="Trạng thái">
                    {a.enabled ? '✓ bật' : '— tắt'}
                    {profileDisabledNotice[a.id] && (
                      <div className="error health-detail">
                        Agent đang bị tắt trong hồ sơ — bật lại ở Nâng cao › Cấu hình
                      </div>
                    )}
                  </td>
                  <td data-label="Lần chạy gần nhất">
                    {a.last_run
                      ? `${labelFor(KIND_LABEL, a.last_run.kind)} · ${labelFor(RUN_STATUS_LABEL, a.last_run.status)}`
                      : 'chưa chạy'}
                  </td>
                  <td data-label="Ngân sách">{status ? `$${status.budget.spent.toFixed(2)} / $${status.budget.cap.toFixed(2)}` : '…'}</td>
                  <td data-label="Chờ duyệt">{status ? status.pending_approvals : '…'}</td>
                  <td>
                    <button type="button" className="btn" disabled={busyId === a.id} onClick={() => toggleEnabled(a)}>
                      {a.enabled ? 'Tạm dừng' : 'Bật lại'}
                    </button>{' '}
                    {a.id !== 'default' && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busyId === a.id}
                        onClick={() => setConfirmingDelete(a.id)}
                      >
                        Xoá
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {confirmingDelete && (
        <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="Xác nhận xoá">
          <h3>Xoá agent {confirmingDelete}?</h3>
          <p>Agent bị gỡ khỏi danh sách. Hồ sơ của agent vẫn được giữ lại để lưu trữ.</p>
          <button type="button" className="btn btn-danger" disabled={busyId === confirmingDelete} onClick={() => confirmDelete(confirmingDelete)}>
            {busyId === confirmingDelete ? 'Đang xoá…' : 'Xoá'}
          </button>{' '}
          <button type="button" className="btn" disabled={busyId === confirmingDelete} onClick={() => setConfirmingDelete(null)}>
            Huỷ
          </button>
        </div>
      )}
    </section>
  )
}
