// First-run Setup Wizard (v7 M17): shown when the server has no auth configured yet. Walks
// the CEO through entering keys (per group, with a Test button), then sets a password and
// finishes — which writes .env, marks setup complete, and restarts the web service. After
// that the wizard is gone (410) and the app shows Login. No text editor, ever.
import { useCallback, useState } from 'react'
import { ApiError, api } from '../api/client'

interface Field {
  key: string
  label: string
  type?: 'password' | 'text'
}

interface Group {
  id: string
  title: string
  fields: Field[]
  testable: boolean
  hint?: string
}

// The steps. GitHub is auth'd via the `gh` CLI (no key field) — just a Test.
const GROUPS: Group[] = [
  {
    id: 'openrouter',
    title: 'OpenRouter (bộ não LLM)',
    fields: [{ key: 'OPENROUTER_API_KEY', label: 'API key', type: 'password' }],
    testable: true,
    hint: 'Lấy key tại openrouter.ai → Keys.',
  },
  {
    id: 'atlassian',
    title: 'Atlassian (Jira + Confluence)',
    fields: [
      { key: 'ATLASSIAN_SITE_NAME', label: 'Site (vd acme.atlassian.net)' },
      { key: 'ATLASSIAN_USER_EMAIL', label: 'Email' },
      { key: 'ATLASSIAN_API_TOKEN', label: 'API token', type: 'password' },
      { key: 'JIRA_PROJECT_KEY', label: 'Mã Jira project (vd SCRUM)' },
    ],
    testable: true,
  },
  {
    id: 'slack',
    title: 'Slack',
    fields: [
      { key: 'SLACK_XOXC_TOKEN', label: 'xoxc token', type: 'password' },
      { key: 'SLACK_XOXD_TOKEN', label: 'xoxd token', type: 'password' },
      { key: 'SLACK_TEAM_DOMAIN', label: 'Team domain (vd acme.slack.com)' },
      { key: 'SLACK_REPORT_CHANNEL', label: 'Kênh báo cáo (id hoặc #tên)' },
    ],
    testable: true,
  },
  {
    id: 'github',
    title: 'GitHub',
    fields: [{ key: 'GITHUB_REPO', label: 'Repo (owner/tên)' }],
    testable: true,
    hint: 'Đăng nhập GitHub CLI trên máy chủ: chạy `gh auth login` một lần.',
  },
]

export function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0) // 0..GROUPS.length-1 = key groups; then password step
  const [values, setValues] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordStep = step === GROUPS.length
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('admin')
  const [finished, setFinished] = useState(false)

  const setField = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }))

  const saveGroup = useCallback(
    async (g: Group) => {
      const toWrite: Record<string, string> = {}
      for (const f of g.fields) if (values[f.key]?.trim()) toWrite[f.key] = values[f.key]
      if (Object.keys(toWrite).length) await api.setupEnv(toWrite)
    },
    [values],
  )

  const test = useCallback(
    async (g: Group) => {
      setBusy(true)
      setError(null)
      try {
        await saveGroup(g) // persist before testing so the backend sees fresh values
        const r = await api.setupTest(g.id)
        setTestResult((s) => ({ ...s, [g.id]: { ok: r.ok, detail: r.detail } }))
      } catch (e: unknown) {
        setError(e instanceof ApiError ? e.message : 'kiểm tra thất bại')
      } finally {
        setBusy(false)
      }
    },
    [saveGroup],
  )

  const next = useCallback(
    async (g: Group) => {
      setBusy(true)
      setError(null)
      try {
        await saveGroup(g)
        setStep((s) => s + 1)
      } catch (e: unknown) {
        setError(e instanceof ApiError ? e.message : 'lưu thất bại')
      } finally {
        setBusy(false)
      }
    },
    [saveGroup],
  )

  const finish = useCallback(async () => {
    if (password.length < 6) {
      setError('Mật khẩu tối thiểu 6 ký tự.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.setupFinish(username, password)
      setFinished(true)
      // give launchd ~6s to restart, then re-check (App will show Login)
      setTimeout(onDone, 6000)
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'hoàn tất thất bại')
      setBusy(false)
    }
  }, [password, username, onDone])

  if (finished) {
    return (
      <div className="setup-screen">
        <div className="setup-box">
          <h1>Đang khởi động lại…</h1>
          <p>Đã lưu cấu hình. Dịch vụ đang khởi động lại — đợi vài giây rồi đăng nhập.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="setup-screen">
      <div className="setup-box">
        <div className="setup-progress">
          Bước {step + 1}/{GROUPS.length + 1}
        </div>
        {!passwordStep ? (
          <>
            <h1>{GROUPS[step].title}</h1>
            {GROUPS[step].hint && <p className="setup-hint">{GROUPS[step].hint}</p>}
            {GROUPS[step].fields.map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type={f.type ?? 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </label>
            ))}
            {testResult[GROUPS[step].id] && (
              <p className={testResult[GROUPS[step].id].ok ? 'setup-ok' : 'error'}>
                {testResult[GROUPS[step].id].ok ? '✓ Kết nối OK' : '✗ '}
                {testResult[GROUPS[step].id].detail}
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <div className="setup-actions">
              {GROUPS[step].testable && (
                <button type="button" disabled={busy} onClick={() => void test(GROUPS[step])}>
                  Kiểm tra kết nối
                </button>
              )}
              {step > 0 && (
                <button type="button" disabled={busy} onClick={() => setStep((s) => s - 1)}>
                  Quay lại
                </button>
              )}
              <button
                type="button"
                className="setup-primary"
                disabled={busy}
                onClick={() => void next(GROUPS[step])}
              >
                Tiếp tục
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Đặt mật khẩu đăng nhập</h1>
            <p className="setup-hint">Mật khẩu này bảo vệ dashboard — bạn dùng để đăng nhập.</p>
            <label>
              Tên đăng nhập
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              Mật khẩu (tối thiểu 6 ký tự)
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="setup-actions">
              <button type="button" disabled={busy} onClick={() => setStep((s) => s - 1)}>
                Quay lại
              </button>
              <button
                type="button"
                className="setup-primary"
                disabled={busy || password.length < 6}
                onClick={() => void finish()}
              >
                Hoàn tất & khởi động
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
