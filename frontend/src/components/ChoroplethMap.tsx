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

function ChoroplethMap() {
    const svgRef = useRef<SVGSVGElement | null>(null)
    const [meta, setMeta] = useState<ClimateMeta | null>(null)
    const [metric, setMetric] = useState<string>('')
    const [year, setYear] = useState<number | null>(null)
    const [mapRecords, setMapRecords] = useState<ClimatePoint[]>([])
    const [world, setWorld] = useState<WorldCollection | null>(null)
    const [error, setError] = useState<string>('')
    const [tooltip, setTooltip] = useState<TooltipState | null>(null)

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
                    fetch('http://localhost:5000/api/climate-meta'),
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
                const url = `http://localhost:5000/api/climate-map?metric=${encodeURIComponent(metric)}&year=${year}`
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
            .append('title')
            .text((d) => {
                const name = d.properties?.name ?? 'Unknown'
                const val = dataMap.get(name)
                return typeof val === 'number' ? `${name}: ${val.toFixed(2)}` : `${name}: no data`
            })

        countryPaths
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

    return (
        <div style={{ padding: 16 }}>
            <h2 style={{ marginBottom: 12 }}>Global Climate Choropleth</h2>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <label>
                    Metric{' '}
                    <select value={metric} onChange={(e) => setMetric(e.target.value)} disabled={!meta}>
                        {(meta?.metrics ?? []).map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                </label>

                <label>
                    Year{' '}
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

            <div style={{ marginBottom: 10, maxWidth: 420 }}>
                <div style={{ marginBottom: 6, fontSize: 13 }}>
                    Color legend for {metric || 'selected metric'} ({year ?? 'latest'})
                </div>
                <div
                    style={{
                        height: 14,
                        borderRadius: 999,
                        border: '1px solid #d0d0d0',
                        background: 'linear-gradient(90deg, #ffffcc 0%, #fd8d3c 55%, #bd0026 100%)',
                    }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12 }}>
                    <span>{valueStats.min.toFixed(2)}</span>
                    <span>{valueStats.max.toFixed(2)}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>Gray countries indicate missing data.</div>
            </div>

            {error ? <p style={{ color: '#b00020' }}>{error}</p> : null}

            <div style={{ position: 'relative', width: '100%', maxWidth: 980 }}>
                <svg ref={svgRef} style={{ width: '100%', maxWidth: 980, border: '1px solid #ddd' }} />
            </div>

            {tooltip ? (
                <div
                    style={{
                        position: 'fixed',
                        left: tooltip.x + 14,
                        top: tooltip.y + 14,
                        pointerEvents: 'none',
                        background: '#111827',
                        color: '#fff',
                        padding: '8px 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        lineHeight: 1.4,
                        boxShadow: '0 8px 20px rgba(0,0,0,0.22)',
                        zIndex: 10,
                    }}
                >
                    <div>{tooltip.country}</div>
                    <div>{tooltip.value === null ? 'No data' : `${metric}: ${tooltip.value.toFixed(2)}`}</div>
                </div>
            ) : null}
        </div>
    )
}

export default ChoroplethMap