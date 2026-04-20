import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { formatMetric } from '../utils'

type ClimatePoint = {
    country: string
    value: number
}

type ClimateMeta = {
    years: number[]
    metrics: string[]
    defaultMetric: string | null
}

type ClimateMapResponse = {
    records: ClimatePoint[]
}

type TooltipState = {
    x: number
    y: number
    country: string
    value: number | null
}

type NewsArticle = {
    title: string
    url: string
    source?: string | null
    date?: string | null
}

type NewsResponse = {
    country: string
    query: string
    articles: NewsArticle[]
    warning?: string
}


type WorldFeature = GeoJSON.Feature<GeoJSON.Geometry, { name?: string }>
type WorldCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, { name?: string }>

function toDataMap(records: ClimatePoint[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const row of records) {
        if (typeof row.country === 'string' && Number.isFinite(row.value)) {
            map.set(row.country, Number(row.value))
        }
    }
    return map
}

function isClimateMeta(value: unknown): value is ClimateMeta {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<ClimateMeta>
    return Array.isArray(candidate.years) && Array.isArray(candidate.metrics)
}

function isClimateMapResponse(value: unknown): value is ClimateMapResponse {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<ClimateMapResponse>
    return Array.isArray(candidate.records)
}

function isNewsResponse(value: unknown): value is NewsResponse {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<NewsResponse>
    return typeof candidate.country === 'string' && Array.isArray(candidate.articles)
}


function ChoroplethMap() {
    const svgRef = useRef<SVGSVGElement | null>(null)
    const [meta, setMeta] = useState<ClimateMeta | null>(null)
    const [metric, setMetric] = useState<string>('')
    const [year, setYear] = useState<number | null>(null)
    const [mapRecords, setMapRecords] = useState<ClimatePoint[]>([])
    const [world, setWorld] = useState<WorldCollection | null>(null)
    const [error, setError] = useState<string>('')
    const [tooltip, setTooltip] = useState<TooltipState | null>(null)

    const [hoverCountry, setHoverCountry] = useState<string | null>(null)
    const [pinnedCountry, setPinnedCountry] = useState<string | null>(null)
    const pinnedCountryRef = useRef<string | null>(null)
    const selectedCountry = pinnedCountry ?? hoverCountry

    const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([])
    const [newsLoading, setNewsLoading] = useState(false)
    const [newsError, setNewsError] = useState<string>('')
    const [newsWarning, setNewsWarning] = useState<string>('')
    const newsCacheRef = useRef<Map<string, { articles: NewsArticle[]; warning?: string }>>(new Map())

    useEffect(() => {
        pinnedCountryRef.current = pinnedCountry
    }, [pinnedCountry])

    const valueStats = useMemo(() => {
        const values = mapRecords.map((r) => r.value).filter((v) => Number.isFinite(v))
        const min = values.length ? d3.min(values) ?? 0 : 0
        const max = values.length ? d3.max(values) ?? 1 : 1
        return { min, max }
    }, [mapRecords])

    useEffect(() => {
        let cancelled = false

        async function loadMetaAndMap() {
            try {
                const [metaRes, worldRes] = await Promise.all([
                    fetch('http://127.0.0.1:5001/api/climate-meta'),
                    d3.json<WorldCollection>('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson'),
                ])

                if (!metaRes.ok) {
                    throw new Error('Failed to load /api/climate-meta')
                }

                const metaRaw: unknown = await metaRes.json()
                if (!isClimateMeta(metaRaw)) {
                    throw new Error('Unexpected response shape from /api/climate-meta')
                }

                const metaJson = metaRaw
                if (!cancelled) {
                    setMeta(metaJson)
                    if (metaJson.defaultMetric) {
                        setMetric(metaJson.defaultMetric)
                    }
                    if (metaJson.years?.length) {
                        setYear(metaJson.years[metaJson.years.length - 1])
                    }
                }

                if (!cancelled) {
                    setWorld(worldRes ?? null)
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : 'Failed to load map metadata')
                }
            }
        }

        loadMetaAndMap()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (!metric || year === null) return

        let cancelled = false

        async function loadMapValues() {
            try {
                const url = `http://127.0.0.1:5001/api/climate-map?metric=${encodeURIComponent(metric)}&year=${year}`
                const res = await fetch(url)
                if (!res.ok) {
                    throw new Error('Failed to load /api/climate-map')
                }
                const rawData: unknown = await res.json()
                if (!isClimateMapResponse(rawData)) {
                    throw new Error('Unexpected response shape from /api/climate-map')
                }

                const data = rawData
                if (!cancelled) {
                    setMapRecords(Array.isArray(data.records) ? data.records : [])
                    setError('')
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : 'Failed to load map values')
                    setMapRecords([])
                }
            }
        }

        loadMapValues()
        return () => {
            cancelled = true
        }
    }, [metric, year])



    useEffect(() => {
        if (!svgRef.current || !world) return

        const width = 980
        const height = 560
        const svg = d3.select(svgRef.current)

        svg.selectAll('*').remove()
        svg.attr('width', width).attr('height', height)

        const projection = d3.geoNaturalEarth1().fitSize([width, height], world)
        const path = d3.geoPath(projection)
        const dataMap = toDataMap(mapRecords)
        const color = d3.scaleSequential(d3.interpolateYlOrRd).domain([valueStats.min, valueStats.max || 1])

        const countryPaths = svg
            .append('g')
            .selectAll('path')
            .data(world.features as WorldFeature[])
            .join('path')
            .attr('d', (d) => path(d) ?? '')
            .attr('fill', (d) => {
                const name = d.properties?.name ?? ''
                const val = dataMap.get(name)
                return typeof val === 'number' ? color(val) : '#d9d9d9'
            })
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 0.6)


        countryPaths
            .on('mouseover', (_event: MouseEvent, d) => {
                const countryName = d.properties?.name ?? ''
                if (!countryName) return
                if (!pinnedCountryRef.current) {
                    setHoverCountry(countryName)
                }
            })
            .on('click', (_event: MouseEvent, d) => {
                const countryName = d.properties?.name ?? ''
                if (!countryName) return
                setPinnedCountry((prev) => (prev === countryName ? null : countryName))
                setHoverCountry(countryName)
            })
            .on('mousemove', (event: MouseEvent, d) => {
                const countryName = d.properties?.name ?? 'Unknown'
                const val = dataMap.get(countryName)
                setTooltip({
                    x: event.clientX,
                    y: event.clientY,
                    country: countryName,
                    value: typeof val === 'number' ? val : null,
                })
            })
            .on('mouseleave', () => {
                setTooltip(null)
            })
    }, [world, mapRecords, valueStats.max, valueStats.min])

    useEffect(() => {
        if (!selectedCountry) {
            setNewsArticles([])
            setNewsError('')
            setNewsWarning('')
            setNewsLoading(false)
            return
        }

        const cached = newsCacheRef.current.get(selectedCountry)
        if (cached) {
            setNewsArticles(cached.articles)
            setNewsWarning(cached.warning ?? '')
            setNewsError('')
            setNewsLoading(false)
            return
        }

        const controller = new AbortController()
        const isHoverSelection = pinnedCountry === null
        const delayMs = isHoverSelection ? 250 : 0

        setNewsLoading(true)
        setNewsError('')
        setNewsWarning('')

        const timer = window.setTimeout(async () => {
            try {
                const url = `http://127.0.0.1:5001/api/climate-news?country=${encodeURIComponent(selectedCountry)}&limit=5`
                const res = await fetch(url, { signal: controller.signal })
                const raw: unknown = await res.json().catch(() => null)

                if (!res.ok) {
                    const message = (raw as any)?.error
                    throw new Error(typeof message === 'string' ? message : 'Failed to load /api/climate-news')
                }

                if (!isNewsResponse(raw)) {
                    throw new Error('Unexpected response shape from /api/climate-news')
                }

                newsCacheRef.current.set(selectedCountry, { articles: raw.articles, warning: raw.warning })
                setNewsArticles(raw.articles)
                setNewsWarning(raw.warning ?? '')
                setNewsError('')
            } catch (e) {
                if (controller.signal.aborted) return
                setNewsArticles([])
                setNewsError(e instanceof Error ? e.message : 'Failed to load climate news')
            } finally {
                if (!controller.signal.aborted) {
                    setNewsLoading(false)
                }
            }
        }, delayMs)

        return () => {
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [selectedCountry, pinnedCountry])

    return (
        <div className="choropleth-layout">
            <div className="choropleth-map-area">
                <h2>Global Climate Choropleth</h2>
                {error ? <p style={{ color: '#b00020', margin: '0 0 8px' }}>{error}</p> : null}
                <div style={{ position: 'relative', width: '100%', flex: 1 }}>
                    <svg ref={svgRef} style={{ width: '100%', maxWidth: 980, display: 'block' }} />
                </div>
            </div>

            <div className="map-sidebar">
                <h3>Controls</h3>

                <label>
                    Metric
                    <select value={metric} onChange={(e) => setMetric(e.target.value)} disabled={!meta}>
                        {(meta?.metrics ?? []).map((m) => (
                            <option key={m} value={m}>{formatMetric(m)}</option>
                        ))}
                    </select>
                </label>

                <label>
                    Year
                    <select
                        value={year ?? ''}
                        onChange={(e) => setYear(Number(e.target.value))}
                        disabled={!meta || (meta.years?.length ?? 0) === 0}
                    >
                        {(meta?.years ?? []).map((y) => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                </label>

                <div>
                    <div className="legend-label">{metric ? formatMetric(metric) : 'Metric'} ({year ?? 'latest'})</div>
                    <div className="legend-bar" />
                    <div className="legend-range">
                        <span>{valueStats.min.toFixed(2)}</span>
                        <span>{valueStats.max.toFixed(2)}</span>
                    </div>
                    <div className="legend-note">Gray = missing data</div>
                </div>

                <div>
                    <div className="news-header">
                        <div className="news-title">Latest News</div>
                        <button
                            type="button"
                            className="news-pin-btn"
                            disabled={!selectedCountry}
                            onClick={() => {
                                if (!selectedCountry) return
                                setPinnedCountry((prev) => (prev === selectedCountry ? null : selectedCountry))
                            }}
                        >
                            {pinnedCountry ? 'Unpin' : 'Pin'}
                        </button>
                    </div>

                    <div className="news-country">
                        {selectedCountry ? selectedCountry : 'Hover a country'}
                    </div>

                    {!selectedCountry ? <div className="news-hint">Hover on the map to preview headlines.</div> : null}
                    {newsLoading ? <div className="news-hint">Loading…</div> : null}
                    {newsError ? <div className="news-error">{newsError}</div> : null}
                    {newsWarning ? <div className="news-warning">{newsWarning}</div> : null}

                    {!newsLoading && !newsError && selectedCountry ? (
                        newsArticles.length ? (
                            <ol className="news-list">
                                {newsArticles.map((a) => (
                                    <li key={a.url} className="news-item">
                                        <a className="news-link" href={a.url} target="_blank" rel="noreferrer">
                                            {a.title}
                                        </a>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <div className="news-hint">No recent results found.</div>
                        )
                    ) : null}
                </div>
            </div>

            {tooltip ? (
                <div
                    style={{
                        position: 'fixed',
                        left: tooltip.x + 14,
                        top: tooltip.y + 14,
                        pointerEvents: 'none',
                        background: '#ffffff',
                        color: '#1f2937',
                        padding: '8px 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        lineHeight: 1.4,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                        border: '1px solid #e5e7eb',
                        zIndex: 10,
                    }}
                >
                    <div style={{ fontWeight: 600 }}>{tooltip.country}</div>
                    <div>{tooltip.value === null ? 'No data' : `${formatMetric(metric)}: ${tooltip.value.toFixed(2)}`}</div>
                </div>
            ) : null}
        </div>
    )
}

export default ChoroplethMap