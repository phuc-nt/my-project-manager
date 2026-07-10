// Optional first wizard step: grid of staff templates, shown BEFORE the domain picker.
// Fetches both GET /api/staff-templates and GET /api/packs so a chosen template can
// resolve its `domain` into the full Pack (report_kinds/servers) the rest of the wizard
// needs — applyTemplate() takes that resolved Pack, not just the domain id. "Bỏ qua, tự
// chọn" skips straight to the manual domain picker (step 1) — templates are optional
// prefill, never a forced path.
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Pack, StaffTemplate } from '../types'

export function StaffTemplatePicker({
  onApply,
  onSkip,
}: {
  onApply: (template: StaffTemplate, pack: Pack) => void
  onSkip: () => void
}) {
  const [templates, setTemplates] = useState<StaffTemplate[]>([])
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getStaffTemplates(), api.getPacks()])
      .then(([t, p]) => {
        setTemplates(t.templates)
        setPacks(p.packs)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'không tải được mẫu nhân sự'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p>Đang tải…</p>

  // A fetch failure (GET /api/staff-templates or /api/packs) must not dead-end the
  // wizard (red-team M4): keep "Bỏ qua, tự chọn" reachable so the operator can still
  // create an agent manually, same posture as `error` set later by `choose()` below.
  if (error && templates.length === 0) {
    return (
      <section>
        <p className="error">Lỗi: {error}</p>
        <div className="wizard-nav">
          <button type="button" onClick={onSkip}>
            Bỏ qua, tự chọn
          </button>
        </div>
      </section>
    )
  }

  function choose(template: StaffTemplate) {
    const pack = packs.find((p) => p.id === template.domain)
    if (!pack) {
      setError(`mẫu "${template.role}" dùng loại nhân sự "${template.domain}" chưa cài — chọn thủ công`)
      return
    }
    onApply(template, pack)
  }

  return (
    <section>
      <h3>Bước 0: Chọn mẫu nhân sự (không bắt buộc)</h3>
      {error && <p className="error">Lỗi: {error}</p>}
      {templates.length === 0 ? (
        <p className="muted">Chưa có mẫu nhân sự nào — tự chọn ở bước tiếp theo.</p>
      ) : (
        <div className="staff-template-grid">
          {templates.map((t) => (
            <div key={t.role_id} className="staff-template-card">
              <strong>{t.role}</strong>
              <div className="muted">loại nhân sự: {t.domain}</div>
              <div className="muted">
                báo cáo: {t.reports.length > 0 ? t.reports.join(', ') : 'không có'}
              </div>
              <button type="button" onClick={() => choose(t)}>
                Dùng mẫu này
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="wizard-nav">
        <button type="button" onClick={onSkip}>
          Bỏ qua, tự chọn
        </button>
      </div>
    </section>
  )
}
