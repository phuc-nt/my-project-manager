// v7 M20: "Cài đặt" — integration health at a glance + a "Nâng cao" section linking the
// technical views the CEO rarely needs (they keep their original components, just moved out
// of the top nav so the daily surface stays 4 items). v10 M26: the health list reuses the
// shared IntegrationHealthPanel (one implementation, DRY) instead of an inline copy.
import { Link } from 'react-router'
import { IntegrationHealthPanel } from '../components/IntegrationHealthPanel'
import { useUiMode } from '../ui-mode-context'

// Technical / power-user views — moved here from the flat nav. Nothing is removed; each
// route still renders its existing component.
const ADVANCED = [
  { to: '/overview', label: 'Tổng quan (biểu đồ)' },
  { to: '/company-docs', label: 'Tài liệu công ty' },
  { to: '/create', label: 'Tạo nhân sự ảo' },
  { to: '/timeline', label: 'Timeline hoạt động' },
  { to: '/cost', label: 'Chi phí' },
  { to: '/memory', label: 'Bộ nhớ & Tự động hoá' },
  { to: '/guardrail', label: 'Guardrail (rào chắn)' },
  { to: '/config', label: 'Cấu hình agent' },
  { to: '/trigger', label: 'Chạy báo cáo thủ công' },
]

export function Settings() {
  const { isHigh, setMode } = useUiMode()

  return (
    <section className="settings-page">
      <h2>Cài đặt</h2>

      <section className="mode-toggle-box">
        <h3>Chế độ hiển thị</h3>
        <label className="mode-toggle">
          <input
            type="checkbox"
            checked={isHigh}
            onChange={(e) => setMode(e.target.checked ? 'high' : 'low')}
          />{' '}
          Chế độ nâng cao
        </label>
        <p className="muted">
          Bật để hiện đầy đủ số liệu vận hành cho người kỹ thuật (dòng thời gian, chi phí, bộ nhớ,
          guardrail, cấu hình, chạy tay) ngay trên thanh điều hướng. Tắt để giữ giao diện gọn 4 mục.
        </p>
      </section>

      {/* Sức khỏe hệ thống — the shared panel: per-integration ok/fail + fix hint (v10 M26). */}
      <IntegrationHealthPanel />

      <section>
        <h3>Nâng cao</h3>
        <p className="muted">
          Các trang kỹ thuật — bình thường không cần, nhưng vẫn đầy đủ khi bạn muốn xem sâu.
        </p>
        <ul className="advanced-links">
          {ADVANCED.map((a) => (
            <li key={a.to}>
              <Link to={a.to}>{a.label}</Link>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
