// v8 M23: aggregate today's AUTO-DELIVERED scheduled reports across all agents for the Work
// page's "Đã tự duyệt hôm nay" block, so the CEO always sees what the trust ladder ran without
// them. Client-side fan-out over the existing /api/runs timeline (no new backend) — an event
// carries auto_approved=true when the approval gate auto-delivered a trusted scheduled report.
// (Chat-command auto-approvals are surfaced inline in the bot's reply, not here.)
import { useEffect, useState } from 'react'
import { api } from '../api/client'

export interface AutoApprovedRow {
  agentId: string
  kind: string
  timestamp: string
}

export function useAutoApproved(pollMs = 60_000) {
  const [rows, setRows] = useState<AutoApprovedRow[]>([])

  useEffect(() => {
    let cancelled = false
    const today = new Date().toISOString().slice(0, 10)
    const refresh = async () => {
      try {
        const agents = await api.getAgents()
        const per = await Promise.all(
          agents.map(async (a) => {
            try {
              const { runs } = await api.getRuns(a.id)
              return runs
                .filter((r) => r.auto_approved && (r.ts ?? '').slice(0, 10) === today)
                .map((r) => ({ agentId: a.id, kind: r.kind ?? '?', timestamp: r.ts ?? '' }))
            } catch {
              return [] as AutoApprovedRow[]
            }
          }),
        )
        if (!cancelled) setRows(per.flat())
      } catch {
        /* the block is an overlay; a fetch failure just shows nothing */
      }
    }
    void refresh()
    const t = setInterval(() => void refresh(), pollMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pollMs])

  return { rows }
}
