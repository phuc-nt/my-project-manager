// Wizard Step 4: binding fields per selected pack's servers. All optional except the
// client-side hint that stakeholder_channel should be included in external_channels
// (backend enforces this for real — see agent_create.py's stakeholder cross-check).
import type { WizardState } from './use-create-agent-wizard'

export function BindingsStep({
  state,
  update,
  stakeholderChannelMissing,
}: {
  state: WizardState
  update: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void
  stakeholderChannelMissing: boolean
}) {
  const servers = new Set(state.pack?.servers ?? [])

  return (
    <section>
      <h3>Bước 4: Kết nối (không bắt buộc)</h3>
      {servers.has('jira') && (
        <fieldset>
          <legend>Jira</legend>
          <label>
            Mã dự án (project key):{' '}
            <input value={state.jiraProjectKey} onChange={(e) => update('jiraProjectKey', e.target.value)} />
          </label>
        </fieldset>
      )}
      {servers.has('confluence') && (
        <fieldset>
          <legend>Confluence</legend>
          <label>
            Mã space:{' '}
            <input
              value={state.confluenceSpaceKey}
              onChange={(e) => update('confluenceSpaceKey', e.target.value)}
            />
          </label>{' '}
          <label>
            ID space:{' '}
            <input
              value={state.confluenceSpaceId}
              onChange={(e) => update('confluenceSpaceId', e.target.value)}
            />
          </label>{' '}
          <label>
            ID trang OKR:{' '}
            <input
              value={state.confluenceOkrPageId}
              onChange={(e) => update('confluenceOkrPageId', e.target.value)}
            />
          </label>
        </fieldset>
      )}
      {servers.has('github') && (
        <fieldset>
          <legend>GitHub</legend>
          <label>
            Repo (owner/name):{' '}
            <input value={state.githubRepo} onChange={(e) => update('githubRepo', e.target.value)} />
          </label>
        </fieldset>
      )}
      {servers.has('slack') && (
        <fieldset>
          <legend>Slack</legend>
          <label>
            Kênh báo cáo:{' '}
            <input
              value={state.slackReportChannel}
              onChange={(e) => update('slackReportChannel', e.target.value)}
            />
          </label>{' '}
          <label>
            Kênh cho khách/sếp:{' '}
            <input
              value={state.slackStakeholderChannel}
              onChange={(e) => update('slackStakeholderChannel', e.target.value)}
            />
          </label>{' '}
          <label>
            Kênh bên ngoài (cách nhau dấu phẩy):{' '}
            <input
              value={state.slackExternalChannels}
              onChange={(e) => update('slackExternalChannels', e.target.value)}
              placeholder="C123,C456"
            />
          </label>
          {stakeholderChannelMissing && (
            <p className="muted">
              Gợi ý: kênh khách/sếp thường cũng nằm trong danh sách kênh bên ngoài
            </p>
          )}
        </fieldset>
      )}
      {servers.size === 0 && <p className="muted">Loại nhân sự này không cần kết nối ghi.</p>}
    </section>
  )
}
