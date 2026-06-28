// Thin react-chartjs-2 wrapper: monthly cost series as a line, with the budget cap drawn
// as a flat reference line. Registers only the Chart.js pieces it uses (tree-shake).
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { CostMonth } from '../../types'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

export function CostChart({ series, cap }: { series: CostMonth[]; cap: number }) {
  const labels = series.map((m) => m.month)
  const data = {
    labels,
    datasets: [
      {
        label: 'Spend (USD)',
        data: series.map((m) => m.total_usd),
        borderColor: '#1a73e8',
        backgroundColor: '#1a73e8',
        tension: 0.2,
      },
      {
        label: 'Budget cap',
        data: labels.map(() => cap),
        borderColor: '#d93025',
        borderDash: [6, 4],
        pointRadius: 0,
      },
    ],
  }
  const options = {
    responsive: true,
    scales: { y: { beginAtZero: true, title: { display: true, text: 'USD' } } },
  }
  return <Line data={data} options={options} aria-label="Monthly cost vs budget cap" />
}
