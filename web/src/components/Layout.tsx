// App shell (v7 M20): CEO-first nav — 4 primary destinations (Trợ lý / Đội / Việc / Cài đặt)
// instead of the old flat 12-item bar. "Việc" carries a badge with the total pending-approval
// count across all agents (client-side aggregate — no new backend). The old per-agent global
// picker is gone: per-agent context now lives on each agent page (M18). Technical views
// (Overview/Timeline/Guardrail/Trigger/Memory/Cost) are reachable under Cài đặt → Nâng cao.
import { NavLink, Outlet } from 'react-router'
import { api } from '../api/client'
import { useTeamHealth } from '../hooks/use-team-health'
import { useSharedPendingApprovals } from '../pending-approvals-context'
import { useUiMode } from '../ui-mode-context'
import { ThemeToggle } from './ThemeToggle'

async function logout() {
  try {
    await api.logout()
  } finally {
    window.location.reload() // simplest: reload → App re-checks /api/me → login screen
  }
}

const NAV = [
  { to: 'chat', label: 'Trợ lý' },
  { to: 'team', label: 'Đội', badge: 'health' as const },
  { to: 'work', label: 'Việc', badge: 'approvals' as const },
  { to: 'settings', label: 'Cài đặt' },
]

// High-mode ("Chế độ nâng cao") extra destinations — the technical views that low mode keeps
// tucked under Cài đặt → Nâng cao. Same routes, just surfaced in the nav for power users.
const ADVANCED_NAV = [
  { to: 'overview', label: 'Tổng quan' },
  { to: 'timeline', label: 'Dòng thời gian' },
  { to: 'cost', label: 'Chi phí' },
  { to: 'memory', label: 'Bộ nhớ' },
  { to: 'guardrail', label: 'Guardrail' },
  { to: 'config', label: 'Cấu hình' },
  { to: 'trigger', label: 'Chạy tay' },
]

export function Layout() {
  const { count } = useSharedPendingApprovals()
  const { highCount } = useTeamHealth()
  const { isHigh } = useUiMode()
  const badgeFor = (b?: 'health' | 'approvals') =>
    b === 'approvals' ? count : b === 'health' ? highCount : 0
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>my-project-manager</h1>
        <div className="app-header-actions">
          <ThemeToggle />
          <button type="button" className="logout-btn" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </header>
      <nav className="app-nav app-nav-primary">
        {NAV.map((n) => {
          const badgeCount = badgeFor(n.badge)
          return (
            <NavLink key={n.label} to={n.to}>
              {n.label}
              {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
            </NavLink>
          )
        })}
      </nav>
      {isHigh && (
        <nav className="app-nav app-nav-advanced" aria-label="Nâng cao">
          {ADVANCED_NAV.map((n) => (
            <NavLink key={n.to} to={n.to}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
