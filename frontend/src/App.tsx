import ChoroplethMap from './components/ChoroplethMap'
import BubbleScatterPlot from './components/BubbleScatterPlot'
import './App.css'

function App() {
  return (
    <div className="app-wrapper">
      <header className="app-header">
        <h1 className="app-header__title">
          Climate Data<br />Exploratory Dashboard
        </h1>
        <button
          className="app-header__help"
          type="button"
          aria-label="Help"
          title="About this dashboard"
        >
          ?
        </button>
      </header>

      <main className="app-content">
        <section className="hero-section">
          <p className="hero-section__text">
            Climate change is a serious issue that is arising, but it is important
            for everyone to know why it is happening, how it affects the world,
            and what we can do about it.
          </p>
        </section>

        <div className="section-card">
          <ChoroplethMap />
        </div>

        <div className="section-card">
          <BubbleScatterPlot />
        </div>

        <div className="section-card placeholder-card">
          <p className="placeholder-card__text">
            Local news integration / word map of climate change issues seen
          </p>
        </div>
      </main>
    </div>
  )
}

export default App
