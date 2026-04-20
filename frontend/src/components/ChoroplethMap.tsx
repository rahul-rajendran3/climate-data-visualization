import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

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
    const [pendingHoverCountry, setPendingHoverCountry] = useState<string | null>(null)
    const [pinnedCountry, setPinnedCountry] = useState<string | null>(null)
    const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([])
    const [newsLoading, setNewsLoading] = useState(false)
    const [newsError, setNewsError] = useState<string>('')
    const [newsWarning, setNewsWarning] = useState<string>('')
    const newsCacheRef = useRef<Map<string, NewsArticle[]>>(new Map())
    const lastHoverCountryRef = useRef<string>('')
    const newsPanelHoverRef = useRef<boolean>(false)
    const hoveredPathRef = useRef<SVGPathElement | null>(null)
    const pinnedPathRef = useRef<SVGPathElement | null>(null)

    const pinnedCountryRef = useRef<string | null>(null)
    useEffect(() => {
        pinnedCountryRef.current = pinnedCountry
    }, [pinnedCountry])

    const selectedCountry = pinnedCountry ?? hoverCountry

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
        if (!selectedCountry) {
            setNewsLoading(false)
            setNewsError('')
            setNewsWarning('')
            setNewsArticles([])
            return
        }

        const country = selectedCountry

        const cached = newsCacheRef.current.get(country)
        if (cached) {
            setNewsArticles(cached)
            setNewsError('')
            setNewsWarning('')
            setNewsLoading(false)
            return
        }

        const controller = new AbortController()
        setNewsLoading(true)
        setNewsError('')

        const debounceId = window.setTimeout(() => {
            async function loadNews() {
                try {
                    const url = `http://127.0.0.1:5001/api/climate-news?country=${encodeURIComponent(country)}&limit=5`
                    const res = await fetch(url, { signal: controller.signal })

                    if (!res.ok) {
                        let message = `Failed to load climate news (HTTP ${res.status})`
                        try {
                            const maybeJson: any = await res.json()
                            if (maybeJson && typeof maybeJson.error === 'string') {
                                message = maybeJson.error
                            }
                        } catch {
                            // ignore JSON parse failures
                        }
                        throw new Error(message)
                    }

                    const raw: unknown = await res.json()
                    if (!isNewsResponse(raw)) {
                        throw new Error('Unexpected response shape from /api/climate-news')
                    }

                    newsCacheRef.current.set(country, raw.articles ?? [])
                    setNewsArticles(raw.articles ?? [])
                    setNewsWarning(typeof raw.warning === 'string' ? raw.warning : '')
                    setNewsLoading(false)
                } catch (e) {
                    if (controller.signal.aborted) return
                    setNewsLoading(false)
                    setNewsArticles([])
                    setNewsError(e instanceof Error ? e.message : 'Failed to load climate news')
                    setNewsWarning('')
                }
            }

            loadNews()
        }, 900)

        return () => {
            window.clearTimeout(debounceId)
            controller.abort()
        }
    }, [selectedCountry])

    useEffect(() => {
        if (!pendingHoverCountry) return

        const country = pendingHoverCountry
        const hoverIntentDelayMs = 220

        const id = window.setTimeout(() => {
            if (newsPanelHoverRef.current) return
            if (pinnedCountryRef.current) return
            if (country && country !== 'Unknown') {
                setHoverCountry(country)
            }
        }, hoverIntentDelayMs)

        return () => {
            window.clearTimeout(id)
        }
    }, [pendingHoverCountry])



    useEffect(() => {
        if (!svgRef.current || !world) return

        const width = 980
        const height = 560
        const svg = d3.select(svgRef.current)

        svg.selectAll('*').remove()
        svg.attr('viewBox', `0 0 ${width} ${height}`).attr('preserveAspectRatio', 'xMidYMid meet')

        const projection = d3.geoNaturalEarth1().fitSize([width, height], world)
        const path = d3.geoPath(projection)
        const dataMap = toDataMap(mapRecords)
        const color = d3.scaleSequential(d3.interpolateYlOrRd).domain([valueStats.min, valueStats.max || 1])

        const defaultStroke = '#ffffff'
        const defaultStrokeWidth = 0.6
        const hoverStroke = 'var(--accent-border)'
        const pinnedStroke = 'var(--accent)'

        const countryPaths = svg
            .append('g')
            .selectAll<SVGPathElement, WorldFeature>('path')
            .data(world.features as WorldFeature[])
            .join('path')
            .attr('d', (d) => path(d) ?? '')
            .attr('fill', (d) => {
                const name = d.properties?.name ?? ''
                const val = dataMap.get(name)
                return typeof val === 'number' ? color(val) : '#d9d9d9'
            })
            .attr('stroke', defaultStroke)
            .attr('stroke-width', defaultStrokeWidth)

        countryPaths
            .append('title')
            .text((d) => {
                const name = d.properties?.name ?? 'Unknown'
                const val = dataMap.get(name)
                return typeof val === 'number' ? `${name}: ${val.toFixed(2)}` : `${name}: no data`
            })

        countryPaths
            .on('mouseenter', (_event: MouseEvent, d) => {
                const countryName = d.properties?.name ?? 'Unknown'
                if (newsPanelHoverRef.current) return
                if (pinnedCountryRef.current) return

                const currentPath = (_event.currentTarget as SVGPathElement | null) ?? null
                if (currentPath) {
                    if (hoveredPathRef.current && hoveredPathRef.current !== pinnedPathRef.current) {
                        d3.select(hoveredPathRef.current)
                            .attr('stroke', defaultStroke)
                            .attr('stroke-width', defaultStrokeWidth)
                    }

                    hoveredPathRef.current = currentPath
                    if (hoveredPathRef.current !== pinnedPathRef.current) {
                        d3.select(hoveredPathRef.current).attr('stroke', hoverStroke).attr('stroke-width', 1.4)
                    }
                }

                if (countryName && countryName !== 'Unknown' && lastHoverCountryRef.current !== countryName) {
                    lastHoverCountryRef.current = countryName
                    setPendingHoverCountry(countryName)
                }
            })
            .on('click', (_event: MouseEvent, d) => {
                const countryName = d.properties?.name ?? 'Unknown'
                if (!countryName || countryName === 'Unknown') return

                const currentPath = (_event.currentTarget as SVGPathElement | null) ?? null
                const isUnpin = pinnedCountryRef.current === countryName

                if (pinnedPathRef.current) {
                    d3.select(pinnedPathRef.current)
                        .attr('stroke', defaultStroke)
                        .attr('stroke-width', defaultStrokeWidth)
                }

                if (isUnpin) {
                    pinnedPathRef.current = null
                    pinnedCountryRef.current = null
                    setPinnedCountry(null)
                } else {
                    pinnedPathRef.current = currentPath
                    pinnedCountryRef.current = countryName
                    setPinnedCountry(countryName)
                    if (pinnedPathRef.current) {
                        d3.select(pinnedPathRef.current).attr('stroke', pinnedStroke).attr('stroke-width', 2.2)
                    }
                }

                setHoverCountry(countryName)
                setPendingHoverCountry(null)
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
                if (hoveredPathRef.current && hoveredPathRef.current !== pinnedPathRef.current) {
                    d3.select(hoveredPathRef.current)
                        .attr('stroke', defaultStroke)
                        .attr('stroke-width', defaultStrokeWidth)
                    hoveredPathRef.current = null
                }
            })
    }, [world, mapRecords, valueStats.max, valueStats.min])

    return (
        <div className="dashboard">
            <div className="dashboardHeader">
                <div className="dashboardLegend legend">
                    <div className="legendTitle">
                        Color legend for {metric || 'selected metric'} ({year ?? 'latest'})
                    </div>
                    <div className="legendBar" />
                    <div className="legendTicks">
                        <span>{valueStats.min.toFixed(2)}</span>
                        <span>{valueStats.max.toFixed(2)}</span>
                    </div>
                    <div className="hint">Gray countries indicate missing data. Hover to preview. Click a country to pin.</div>
                    {error ? <div className="error">{error}</div> : null}
                </div>

                <div className="controls">
                    <label className="control">
                        <span>Metric</span>
                        <select value={metric} onChange={(e) => setMetric(e.target.value)} disabled={!meta}>
                            {(meta?.metrics ?? []).map((m) => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="control">
                        <span>Year</span>
                        <select
                            value={year ?? ''}
                            onChange={(e) => setYear(Number(e.target.value))}
                            disabled={!meta || (meta.years?.length ?? 0) === 0}
                        >
                            {(meta?.years ?? []).map((y) => (
                                <option key={y} value={y}>
                                    {y}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>

            <div className="dashboardBody">
                <div className="mapPane">
                    <div className="mapFrame">
                        <svg ref={svgRef} className="mapSvg" />
                    </div>
                </div>

                <div
                    className="newsPane"
                    onMouseEnter={() => {
                        newsPanelHoverRef.current = true
                    }}
                    onMouseLeave={() => {
                        newsPanelHoverRef.current = false
                    }}
                >
                    <div className="panel">
                        <div className="panelHeader">
                            <div>
                                <div className="panelTitle">
                                    Latest climate news{selectedCountry ? ` — ${selectedCountry}` : ''}
                                </div>
                                <div className="panelMeta">
                                    {pinnedCountry
                                        ? 'Pinned (click the same country again to unpin)'
                                        : 'Hover a country to preview; click to pin'}
                                </div>
                            </div>

                            <button
                                type="button"
                                className="pinButton"
                                disabled={!selectedCountry}
                                onClick={() => {
                                    if (!selectedCountry) return
                                    setPinnedCountry((prev) => (prev === selectedCountry ? null : selectedCountry))
                                }}
                            >
                                {pinnedCountry ? 'Unpin' : 'Pin'}
                            </button>
                        </div>

                        <div className="panelBody">
                            {!selectedCountry ? <div className="hint">Hover any country on the map to load headlines here.</div> : null}
                            {newsLoading ? <div className="hint">Loading…</div> : null}
                            {newsError ? <div className="error">{newsError}</div> : null}
                            {newsWarning ? <div className="warning">{newsWarning}</div> : null}

                            {!newsLoading && !newsError && selectedCountry ? (
                                newsArticles.length ? (
                                    <ol className="newsList">
                                        {newsArticles.map((a) => (
                                            <li key={a.url} className="newsItem">
                                                <a className="newsLink" href={a.url} target="_blank" rel="noreferrer">
                                                    {a.title}
                                                </a>
                                                {a.source ? <span> — {a.source}</span> : null}
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <div className="hint">No recent results found.</div>
                                )
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>

            {tooltip ? (
                <div className="tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
                    <div>{tooltip.country}</div>
                    <div>{tooltip.value === null ? 'No data' : `${metric}: ${tooltip.value.toFixed(2)}`}</div>
                    <div style={{ marginTop: 4, opacity: 0.9 }}>
                        News: {newsLoading ? 'loading…' : newsError ? 'unavailable' : selectedCountry ? 'see panel' : '—'}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export default ChoroplethMap