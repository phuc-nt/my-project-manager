// Theme switcher (v10 M24): a 3-way segmented control — Sáng / Tối / Tự động. Kept as buttons
// (not a <select>) so the current choice is always visible and one tap changes it. Labels are
// Vietnamese-first to match the CEO-facing surfaces.
import { useTheme } from '../theme-context'
import type { ThemePref } from '../theme-context'

const OPTIONS: { pref: ThemePref; label: string; title: string }[] = [
  { pref: 'light', label: 'Sáng', title: 'Giao diện sáng' },
  { pref: 'dark', label: 'Tối', title: 'Giao diện tối' },
  { pref: 'auto', label: 'Tự động', title: 'Theo hệ điều hành' },
]

export function ThemeToggle() {
  const { pref, setPref } = useTheme()
  return (
    <div className="theme-toggle" role="group" aria-label="Giao diện">
      {OPTIONS.map((o) => (
        <button
          key={o.pref}
          type="button"
          className={o.pref === pref ? 'theme-toggle-btn active' : 'theme-toggle-btn'}
          aria-pressed={o.pref === pref}
          title={o.title}
          onClick={() => setPref(o.pref)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
