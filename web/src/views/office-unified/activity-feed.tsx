// Live text activity feed for the unified office screen (v15): the SAME messages the
// 3D canvas renders, as a compact auto-scrolling log. Receives messages as props — the
// unified screen owns the ONE SSE stream (never open a second EventSource here).
import { useEffect, useRef } from 'react'
import type { OfficeMessage } from '../../types'
import { KIND_LABEL, messageLine } from '../office-shared/office-message-line'

//: The feed shows the tail only — the full history lives in the timeline tab
//: (OfficeRoom); this panel is a live "what's happening right now" strip.
const FEED_TAIL = 40

interface ActivityFeedProps {
  messages: OfficeMessage[]
  connected: boolean
  errored: boolean
}

export function ActivityFeed({ messages, connected, errored }: ActivityFeedProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const tail = messages.slice(-FEED_TAIL)

  // Auto-scroll to the newest entry whenever one arrives — the feed is a live strip,
  // not a reading pane (deep reading belongs to the timeline tab).
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  return (
    <aside className="office-unified-feed" aria-label="Hoạt động trực tiếp">
      <p className="office-room-status">
        {errored ? 'Mất kết nối luồng — thử tải lại trang.' : connected ? 'Hoạt động trực tiếp' : 'Đang kết nối…'}
      </p>
      {tail.length === 0 && !errored && (
        <p className="ops-chat-empty">Chưa có hoạt động nào.</p>
      )}
      <ul className="office-room-log office-unified-log" ref={listRef}>
        {tail.map((m) => (
          <li key={m.seq} className={`office-room-entry office-room-${m.kind}`}>
            <span className="office-room-kind">{KIND_LABEL[m.kind] ?? m.kind}</span>
            <span className="office-room-author">{m.author}</span>
            <p className="office-room-text">{messageLine(m)}</p>
          </li>
        ))}
      </ul>
    </aside>
  )
}
