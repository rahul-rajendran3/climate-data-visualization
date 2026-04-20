import { useState } from 'react'
import ChoroplethMap from './components/ChoroplethMap'
import BubbleScatterPlot from './components/BubbleScatterPlot'
import './App.css'

function App() {
  const [view, setView] = useState<'map' | 'scatter'>('map')

  return (
    <div className="app">
      <header className="appNav">
        <div className="appBrand">Climate Dashboard</div>
        <div className="appTabs" role="tablist" aria-label="Views">
          <button
            type="button"
            className={view === 'map' ? 'tab tabActive' : 'tab'}
            onClick={() => setView('map')}
            role="tab"
            aria-selected={view === 'map'}
          >
            Map View
          </button>
          <button
            type="button"
            className={view === 'scatter' ? 'tab tabActive' : 'tab'}
            onClick={() => setView('scatter')}
            role="tab"
            aria-selected={view === 'scatter'}
          >
            Scatter Plot
          </button>
        </div>
      </header>

      <div className="appContent">
        {view === 'map' ? (
          <ChoroplethMap />
        ) : (
          <div className="scatterView">
            <BubbleScatterPlot />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
