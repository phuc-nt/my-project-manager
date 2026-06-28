// Small fetch hook: run an api call for the currently-selected agent, exposing
// {data, loading, error}. DRY across the 4 views — each passes the api fn it needs.
import { useEffect, useState } from 'react'
import { useAgent } from '../agent-context'

export function useAgentData<T>(fetcher: (id: string) => Promise<T>): {
  data: T | null
  loading: boolean
  error: string | null
} {
  const { selected } = useAgent()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selected) {
      // No agent selectable (empty registry / agents fetch failed) — don't hang on
      // the initial loading=true; surface an empty state instead of an eternal spinner.
      setLoading(false)
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcher(selected)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'request failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, fetcher])

  return { data, loading, error }
}
