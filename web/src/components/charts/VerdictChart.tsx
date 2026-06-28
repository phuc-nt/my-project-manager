// Thin react-chartjs-2 wrapper: guardrail verdict breakdown as a doughnut. Colors map the
// safety meaning (allow=green, deny=red, pending=amber, …). Registers only used pieces.
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'

ChartJS.register(ArcElement, Tooltip, Legend)

const COLORS: Record<string, string> = {
  allow: '#34a853',
  deny: '#d93025',
  pending: '#f9ab00',
  reject: '#a142f4',
  dry_run: '#9aa0a6',
  skipped: '#bdc1c6',
}

export function VerdictChart({ counts }: { counts: Record<string, number> }) {
  const labels = Object.keys(counts)
  const data = {
    labels,
    datasets: [
      {
        data: labels.map((k) => counts[k]),
        backgroundColor: labels.map((k) => COLORS[k] ?? '#5f6368'),
      },
    ],
  }
  return <Doughnut data={data} aria-label="Guardrail verdict breakdown" />
}
