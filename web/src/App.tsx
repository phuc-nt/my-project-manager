// Router root. browser-router with basename="/static/app" (the FastAPI static mount this
// slice serves from); S5 drops the basename to "/" when the SPA moves to the / catch-all.
import { BrowserRouter, Route, Routes } from 'react-router'
import './App.css'
import { AgentProvider } from './agent-context'
import { Layout } from './components/Layout'
import { Cost } from './views/Cost'
import { Guardrail } from './views/Guardrail'
import { MemoryAutomation } from './views/MemoryAuto'
import { Overview } from './views/Overview'
import { Timeline } from './views/Timeline'

function App() {
  return (
    <BrowserRouter basename="/static/app">
      <AgentProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="cost" element={<Cost />} />
            <Route path="memory" element={<MemoryAutomation />} />
            <Route path="guardrail" element={<Guardrail />} />
          </Route>
        </Routes>
      </AgentProvider>
    </BrowserRouter>
  )
}

export default App
