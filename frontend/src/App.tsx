import { useState } from 'react'
import ChoroplethMap from './components/ChoroplethMap'
import BubbleScatterPlot from './components/BubbleScatterPlot'
import NewsWordMap from './components/NewsWordMap'
import { formatMetric, METRIC_DESCRIPTIONS } from './utils'
import './App.css'

type View = 'choropleth' | 'scatter' | 'news'

const VIEWS: { id: View; label: string }[] = [
  { id: 'choropleth', label: 'Choropleth Map' },
  { id: 'scatter',    label: 'Bubble Scatter Plot' },
  { id: 'news',       label: 'News Word Map' },
]

function App() {
  const [activeView, setActiveView] = useState<View>('choropleth')
  const [showHelp, setShowHelp] = useState(false)

  return (
    <div className="app-wrapper">
      <header className="app-header">
        <h1 className="app-header__title">
          Climate Data Exploratory Dashboard
        </h1>

        <div className="app-header__right">
          <nav className="view-nav" aria-label="Visualization selector">
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`view-nav__btn${activeView === id ? ' view-nav__btn--active' : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  setActiveView(id)
                }}
                onClick={() => setActiveView(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <button
            className="app-header__help"
            type="button"
            aria-label="Help"
            title="Metric descriptions"
            onClick={() => setShowHelp(true)}
          >
            ?
          </button>
        </div>
      </header>

      <main className="app-content">
        {/* <section className="hero-section">
          <p className="hero-section__text">
            Climate change is a serious issue that is arising, but it is important
            for everyone to know why it is happening, how it affects the world,
            and what we can do about it.
          </p>
        </section> */}

        {activeView === 'choropleth' && (
          <div className="section-card">
            <ChoroplethMap />
          </div>
        )}

        {activeView === 'scatter' && (
          <div className="section-card">
            <BubbleScatterPlot />
          </div>
        )}

        {activeView === 'news' && (
          <div className="section-card">
            <NewsWordMap />
          </div>
        )}
      </main>

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="help-modal__header">
              <h2>Metric Descriptions</h2>
              <button
                className="help-modal__close"
                onClick={() => setShowHelp(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <ul className="help-modal__list">
              {Object.entries(METRIC_DESCRIPTIONS).map(([key, desc]) => (
                <li key={key}>
                  <strong>{formatMetric(key)}</strong>
                  <p>{desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
