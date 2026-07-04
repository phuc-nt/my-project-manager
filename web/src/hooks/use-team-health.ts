// v8 M21: surface fleet-health alerts (agent chết ngầm etc.) as a count for the "Đội" nav
// badge, so a CEO sees a red dot the moment an agent goes quiet — without opening the panel.
// Reads the existing /api/team/alerts endpoint (no new backend); counts high-severity alerts.
import { useEffect, useState } from 'react'
import { api } from '../api/client'

export function useTeamHealth(pollMs = 60_000) {
  const [highCount, setHighCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      api
        .getTeamAlerts()
        .then((p) => {
          if (!cancelled) setHighCount(p.alerts.filter((a) => a.severity === 'high').length)
        })
        .catch(() => {
          /* alerts are an overlay; a fetch failure must not surface as a scary badge */
        })
    }
    refresh()
    const t = setInterval(refresh, pollMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pollMs])

  return { highCount }
}
