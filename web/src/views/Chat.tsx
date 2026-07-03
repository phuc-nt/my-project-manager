// CEO chat-ops view (v6 M14b): a chat box that talks to the admin agent's ops engine in
// Vietnamese — create agents, enable/disable, ask status/cost. It POSTs each message to
// /api/ops/chat, which drives the SAME engine + SAME per-operator conversation store as the
// Telegram DM path, so a dialogue can span both surfaces. No SSE: an ops reply is one short
// turn (request/response), not a streamed run.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

interface Turn {
  who: 'ceo' | 'agent'
  text: string
}

export function Chat() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [unavailableReason, setUnavailableReason] = useState<string>('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .opsChatAvailable()
      .then((r) => {
        setAvailable(r.available)
        if (!r.available) setUnavailableReason(r.reason ?? '')
      })
      .catch((e: unknown) => {
        setAvailable(false)
        setUnavailableReason(e instanceof Error ? e.message : 'không kiểm tra được')
      })
  }, [])

  useEffect(() => {
    // guarded: jsdom (tests) has no scrollIntoView
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [turns])

  const send = useCallback(async () => {
    const message = draft.trim()
    if (!message || busy) return
    setTurns((t) => [...t, { who: 'ceo', text: message }])
    setDraft('')
    setBusy(true)
    setError(null)
    try {
      const res = await api.opsChat(message)
      setTurns((t) => [...t, { who: 'agent', text: res.reply }])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'gửi thất bại')
    } finally {
      setBusy(false)
    }
  }, [draft, busy])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  if (available === null) return <p>Đang kiểm tra…</p>
  if (available === false) {
    return (
      <section>
        <h2>Trợ lý điều hành</h2>
        <p className="error">Chưa dùng được: {unavailableReason}</p>
      </section>
    )
  }

  return (
    <section className="ops-chat">
      <h2>Trợ lý điều hành</h2>
      <p className="ops-chat-hint">
        Nhắn tiếng Việt để quản lý đội: tạo agent, bật/tắt, xem trạng thái, xem chi phí. Mọi
        thay đổi đều được xem trước và cần bạn xác nhận.
      </p>
      <div className="ops-chat-log">
        {turns.length === 0 && (
          <p className="ops-chat-empty">
            Ví dụ: “đội mình đang có mấy agent, tốn bao nhiêu?” hoặc “tạo agent mã sales-pm,
            vai trò quản lý dự án”.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`ops-chat-turn ops-chat-${t.who}`}>
            <span className="ops-chat-who">{t.who === 'ceo' ? 'Bạn' : 'Trợ lý'}</span>
            <pre className="ops-chat-text">{t.text}</pre>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="ops-chat-input">
        <input
          type="text"
          value={draft}
          placeholder="Nhắn cho trợ lý…"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" onClick={() => void send()} disabled={busy || !draft.trim()}>
          {busy ? 'Đang gửi…' : 'Gửi'}
        </button>
      </div>
    </section>
  )
}
