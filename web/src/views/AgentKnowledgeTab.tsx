// v7 M18b: the Knowledge tab of the agent page — SOUL/PROJECT edited as a form (↔ markdown,
// with a raw fallback when the file was hand-edited) + a skills picker. Split out of
// AgentPage.tsx to keep that view focused; the tab is self-contained (own state + api calls).
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import type { KnowledgePayload, SkillsPayload } from '../types'

// Form field labels MIRROR src/agent/knowledge_template.py — same keys, same order. The
// backend owns the markdown shape; the UI only collects the values keyed by these names.
const KNOWLEDGE_FIELDS: Record<'soul' | 'project', { key: string; label: string; big: boolean }[]> = {
  soul: [
    { key: 'role', label: 'Vai trò của agent (1 câu)', big: false },
    { key: 'tone', label: 'Giọng điệu khi trả lời', big: false },
    { key: 'rules', label: 'Quy tắc riêng (mỗi dòng một ý)', big: true },
  ],
  project: [
    { key: 'team', label: 'Thành viên đội + vai trò', big: true },
    { key: 'conventions', label: 'Quy ước (nhãn, quy trình…)', big: true },
    { key: 'notes', label: 'Ghi chú khác', big: true },
  ],
}

export function KnowledgeTab({ id }: { id: string }) {
  return (
    <div className="knowledge-tab">
      <KnowledgeDoc id={id} doc="soul" title="Tính cách (SOUL)" />
      <KnowledgeDoc id={id} doc="project" title="Bối cảnh dự án (PROJECT)" />
      <SkillsPicker id={id} />
    </div>
  )
}

// One SOUL/PROJECT document edited as a FORM. When the file was hand-edited past the markers
// the backend returns raw_mode — we then show the raw markdown textarea instead of guessing a
// form (matches the backend contract; the form must never clobber prose it can't represent).
function KnowledgeDoc({ id, doc, title }: { id: string; doc: 'soul' | 'project'; title: string }) {
  const [data, setData] = useState<KnowledgePayload | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [rawText, setRawText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(() => {
    api
      .getKnowledge(id, doc)
      .then((d) => {
        setData(d)
        setFields(d.fields)
        setRawText(d.raw)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'lỗi'))
  }, [id, doc])
  useEffect(load, [load])

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      if (data?.raw_mode) await api.putKnowledgeRaw(id, doc, rawText)
      else await api.putKnowledgeForm(id, doc, fields)
      setSaved(true)
      load() // re-read so raw_mode flips correctly if the edit changed the markers
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'lưu thất bại')
    } finally {
      setBusy(false)
    }
  }, [id, doc, data, fields, rawText, load])

  if (error) return <p className="error">Lỗi: {error}</p>
  if (!data) return <p>Đang tải {title}…</p>

  return (
    <section className="knowledge-doc">
      <h4>{title}</h4>
      {data.raw_mode ? (
        <>
          <p className="muted">
            File này đã được sửa tay (chế độ nâng cao) — chỉnh trực tiếp markdown bên dưới.
          </p>
          <textarea rows={8} value={rawText} onChange={(e) => setRawText(e.target.value)} />
        </>
      ) : (
        KNOWLEDGE_FIELDS[doc].map((f) => (
          <label key={f.key}>
            {f.label}
            {f.big ? (
              <textarea
                rows={4}
                value={fields[f.key] ?? ''}
                onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                value={fields[f.key] ?? ''}
                onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            )}
          </label>
        ))
      )}
      <div className="agent-actions">
        <button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu'}
        </button>
        {saved && <span className="ok">✓ Đã lưu</span>}
      </div>
    </section>
  )
}

function SkillsPicker({ id }: { id: string }) {
  const [data, setData] = useState<SkillsPayload | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .getSkills(id)
      .then((d) => {
        setData(d)
        setChosen(new Set(d.skills.filter((s) => s.selected).map((s) => s.name)))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'lỗi'))
  }, [id])

  const toggle = (name: string) =>
    setChosen((p) => {
      const next = new Set(p)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.putSkills(id, [...chosen])
      setSaved(true)
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'lưu thất bại')
    } finally {
      setBusy(false)
    }
  }, [id, chosen])

  if (error) return <p className="error">Lỗi kỹ năng: {error}</p>
  if (!data) return <p>Đang tải kỹ năng…</p>

  return (
    <section className="skills-picker">
      <h4>Kỹ năng</h4>
      {data.skills.length === 0 ? (
        <p className="muted">Domain này chưa có kỹ năng nào.</p>
      ) : (
        <ul className="skills-list">
          {data.skills.map((s) => (
            <li key={s.name}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.has(s.name)}
                  onChange={() => toggle(s.name)}
                />
                <strong>{s.name}</strong> — <span className="muted">{s.description}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="agent-actions">
        <button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu kỹ năng'}
        </button>
        {saved && <span className="ok">✓ Đã lưu</span>}
      </div>
    </section>
  )
}
