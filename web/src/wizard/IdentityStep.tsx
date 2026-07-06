// Wizard Step 2: agent id/name + an optional persona helper. Typing role + goals
// regenerates the SOUL.md textarea (deterministic template, no LLM) until the operator
// edits the textarea by hand — after that we stop overwriting their edits. `personaEdited`
// lives in the wizard's shared state (not a local useState) so it survives this step
// unmounting when the operator navigates Back/Next and returns.
import { generateSoulMarkdown } from './persona-template'
import { ID_PATTERN } from './use-create-agent-wizard'
import type { WizardState } from './use-create-agent-wizard'

export function IdentityStep({
  state,
  update,
}: {
  state: WizardState
  update: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void
}) {
  const idValid = state.id === '' || ID_PATTERN.test(state.id)

  function regenerate(role: string, goals: string) {
    if (!state.personaEdited) update('persona', generateSoulMarkdown(role, goals))
  }

  return (
    <section>
      <h3>Bước 2: Danh tính</h3>
      <label>
        Mã agent (chữ thường, không dấu, ví dụ: sales-pm):{' '}
        <input
          value={state.id}
          onChange={(e) => update('id', e.target.value.toLowerCase())}
          placeholder="sales-pm"
        />
      </label>
      {!idValid && (
        <p className="error">Mã chỉ gồm chữ thường/số/gạch, bắt đầu bằng chữ hoặc số (vd: sales-pm)</p>
      )}
      <br />
      <label>
        Tên hiển thị:{' '}
        <input value={state.name} onChange={(e) => update('name', e.target.value)} placeholder="PM Kinh doanh" />
      </label>
      <h4>Gợi ý tính cách (không bắt buộc)</h4>
      <label>
        Vai trò:{' '}
        <input
          value={state.role}
          onChange={(e) => {
            update('role', e.target.value)
            regenerate(e.target.value, state.goals)
          }}
          placeholder="quản lý dự án cho đội Kinh doanh"
        />
      </label>
      <br />
      <label>
        Mục tiêu (mỗi dòng một ý):{' '}
        <textarea
          value={state.goals}
          onChange={(e) => {
            update('goals', e.target.value)
            regenerate(state.role, e.target.value)
          }}
          rows={3}
        />
      </label>
      <h4>SOUL.md (chỉnh được)</h4>
      <textarea
        className="persona-textarea"
        value={state.persona}
        onChange={(e) => {
          update('personaEdited', true)
          update('persona', e.target.value)
        }}
        rows={8}
      />
    </section>
  )
}
