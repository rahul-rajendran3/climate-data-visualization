import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

type ClimateMeta = {
    years: number[]
    metrics: string[]
    defaultMetric: string | null
}

type ScatterPoint = {
    country: string
    x: number
    y: number
    size: number
}

type ScatterTooltipState = {
    x: number
    y: number
    country: string
    xValue: number
    yValue: number
    sizeValue: number
}

function isClimateMeta(value: unknown): value is ClimateMeta {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<ClimateMeta>
    return Array.isArray(candidate.years) && Array.isArray(candidate.metrics)
}

function BubbleScatterPlot() {
    const scatterSvgRef = useRef<SVGSVGElement | null>(null)
    const [meta, setMeta] = useState<ClimateMeta | null>(null)
    const [xMetric, setXMetric] = useState<string>('')
    const [yMetric, setYMetric] = useState<string>('')
    const [sizeMetric, setSizeMetric] = useState<string>('')
    const [scatterYear, setScatterYear] = useState<number | null>(null)
    const [scatterRecords, setScatterRecords] = useState<ScatterPoint[]>([])
    const [scatterError, setScatterError] = useState<string>('')
    const [scatterTooltip, setScatterTooltip] = useState<ScatterTooltipState | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)

    useEffect(() => {
        let cancelled = false

        async function loadMeta() {
            try {
                const metaRes = await fetch('http://127.0.0.1:5001/api/climate-meta')
                if (!metaRes.ok) throw new Error('Failed to load /api/climate-meta')
                const metaRaw: unknown = await metaRes.json()
                if (!isClimateMeta(metaRaw)) throw new Error('Unexpected response shape from /api/climate-meta')
                if (!cancelled) {
                    setMeta(metaRaw)
                    if (metaRaw.years?.length) {
                        setScatterYear(metaRaw.years[0])
                    }
                    if (metaRaw.metrics.length >= 3) {
                        setXMetric(metaRaw.metrics[0])
                        setYMetric(metaRaw.metrics[1])
                        setSizeMetric(metaRaw.metrics[2])
                    } else if (metaRaw.metrics.length > 0) {
                        setXMetric(metaRaw.metrics[0])
                        setYMetric(metaRaw.metrics[0])
                        setSizeMetric(metaRaw.metrics[0])
                    }
                }
            } catch {
                // meta errors are non-fatal; scatter will stay empty
            }
        }

        loadMeta()
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!xMetric || !yMetric || !sizeMetric || scatterYear === null) return

        let cancelled = false

        async function loadScatterValues() {
            try {
                const res = await fetch('http://127.0.0.1:5001/api/climate-data?limit=500')
                if (!res.ok) {
                    throw new Error('Failed to load /api/climate-data')
                }

                const rawData: unknown = await res.json()
                if (!Array.isArray(rawData)) {
                    throw new Error('Unexpected response shape from /api/climate-data')
                }

                const filtered = rawData.filter((row: any) => {
                    const rowYear = Number(row?.year)
                    return (
                        row &&
                        typeof row.country === 'string' &&
                        rowYear === scatterYear &&
                        Number.isFinite(Number(row[xMetric])) &&
                        Number.isFinite(Number(row[yMetric])) &&
                        Number.isFinite(Number(row[sizeMetric]))
                    )
                })

                const grouped = d3.rollups(
                    filtered,
                    (rows: any[]) => ({
                        country: rows[0].country,
                        x: d3.mean(rows, (r: any) => Number(r[xMetric])) ?? 0,
                        y: d3.mean(rows, (r: any) => Number(r[yMetric])) ?? 0,
                        size: d3.mean(rows, (r: any) => Number(r[sizeMetric])) ?? 0,
                    }),
                    (d: any) => d.country
                ) as Array<[string, ScatterPoint]>

                const points = grouped.map(([, value]: [string, ScatterPoint]) => value)

                if (!cancelled) {
                    setScatterRecords(points)
                    setScatterError('')
                }
            } catch (e) {
                if (!cancelled) {
                    setScatterError(e instanceof Error ? e.message : 'Failed to load scatter values')
                    setScatterRecords([])
                }
            }
        }

        loadScatterValues()
        return () => { cancelled = true }
    }, [xMetric, yMetric, sizeMetric, scatterYear])

    useEffect(() => {
        if (!scatterSvgRef.current) return

        const width = 980
        const height = 520
        const margin = { top: 20, right: 30, bottom: 70, left: 90 }
        const svg = d3.select(scatterSvgRef.current)

        svg.selectAll('*').remove()
        svg.attr('width', width).attr('height', height)

        if (!scatterRecords.length) return

    const xExtent = d3.extent(scatterRecords, (d: ScatterPoint) => d.x) as [number, number]
    const yExtent = d3.extent(scatterRecords, (d: ScatterPoint) => d.y) as [number, number]
    const sizeExtent = d3.extent(scatterRecords, (d: ScatterPoint) => d.size) as [number, number]

        const xPad = (xExtent[1] - xExtent[0]) * 0.08 || 1
        const yPad = (yExtent[1] - yExtent[0]) * 0.08 || 1

        const xScale = d3
            .scaleLinear()
            .domain([xExtent[0] - xPad, xExtent[1] + xPad])
            .range([margin.left, width - margin.right])

        const yScale = d3
            .scaleLinear()
            .domain([yExtent[0] - yPad, yExtent[1] + yPad])
            .range([height - margin.bottom, margin.top])

        const rScale = d3
            .scaleSqrt()
            .domain([Math.max(0, sizeExtent[0] ?? 0), sizeExtent[1] ?? 1])
            .range([5, 18])

        const xAxis = d3.axisBottom(xScale).ticks(7).tickSize(0)
        const yAxis = d3.axisLeft(yScale).ticks(7).tickSize(0)

        // gridlines
        svg.append('g')
            .attr('transform', `translate(0,${height - margin.bottom})`)
            .call(
                d3.axisBottom(xScale)
                    .ticks(7)
                    .tickSize(-(height - margin.top - margin.bottom))
                    .tickFormat(() => '')
            )
            .selectAll('line')
            .attr('stroke', '#273142')
            .attr('stroke-opacity', 0.7)

        svg.append('g')
            .attr('transform', `translate(${margin.left},0)`)
            .call(
                d3.axisLeft(yScale)
                    .ticks(7)
                    .tickSize(-(width - margin.left - margin.right))
                    .tickFormat(() => '')
            )
            .selectAll('line')
            .attr('stroke', '#273142')
            .attr('stroke-opacity', 0.7)

        svg.selectAll('.domain').remove()

        const xAxisGroup = svg.append('g')
            .attr('transform', `translate(0,${height - margin.bottom})`)
            .call(xAxis)

        const yAxisGroup = svg.append('g')
            .attr('transform', `translate(${margin.left},0)`)
            .call(yAxis)

        xAxisGroup.selectAll('text')
            .attr('fill', '#94a3b8')
            .style('font-size', '12px')

        yAxisGroup.selectAll('text')
            .attr('fill', '#94a3b8')
            .style('font-size', '12px')

        xAxisGroup.selectAll('line').attr('stroke', '#475569')
        yAxisGroup.selectAll('line').attr('stroke', '#475569')

        svg.append('text')
            .attr('x', width / 2)
            .attr('y', height - 22)
            .attr('text-anchor', 'middle')
            .attr('fill', '#cbd5e1')
            .style('font-size', '14px')
            .style('font-weight', '500')
            .text(xMetric.replaceAll('_', ' '))

        svg.append('text')
            .attr('transform', 'rotate(-90)')
            .attr('x', -height / 2)
            .attr('y', 28)
            .attr('text-anchor', 'middle')
            .attr('fill', '#cbd5e1')
            .style('font-size', '14px')
            .style('font-weight', '500')
            .text(yMetric.replaceAll('_', ' '))

        const bubbleGroup = svg.append('g')

        bubbleGroup
            .selectAll<SVGCircleElement, ScatterPoint>('circle')
            .data(scatterRecords, (d: ScatterPoint) => d.country)
            .join('circle')
            .attr('cx', (d: ScatterPoint) => xScale(d.x))
            .attr('cy', (d: ScatterPoint) => yScale(d.y))
            .attr('r', 0)
            .attr('fill', '#60a5fa')
            .attr('fill-opacity', 0.65)
            .attr('stroke', '#3b82f6')
            .attr('stroke-width', 1.5)
            .on('mousemove', (event: MouseEvent, d: ScatterPoint) => {
                setScatterTooltip({
                    x: event.clientX,
                    y: event.clientY,
                    country: d.country,
                    xValue: d.x,
                    yValue: d.y,
                    sizeValue: d.size,
                })
            })
            .on('mouseleave', () => {
                setScatterTooltip(null)
            })
            .transition()
            .duration(600)
            .attr('r', (d: ScatterPoint) => rScale(d.size))

        // label only biggest few
        const sortedBySize = [...scatterRecords].sort((a, b) => b.size - a.size).slice(0, 5)

        svg.append('g')
            .selectAll('text.country-label')
            .data(sortedBySize)
            .join('text')
            .attr('class', 'country-label')
            .attr('x', (d: ScatterPoint) => xScale(d.x))
            .attr('y', (d: ScatterPoint) => yScale(d.y) - 12)
            .attr('text-anchor', 'middle')
            .attr('fill', '#e2e8f0')
            .style('font-size', '11px')
            .style('font-weight', '500')
            .text((d: ScatterPoint) => d.country)
    }, [scatterRecords, xMetric, yMetric, scatterYear])

    useEffect(() => {
        if (!isPlaying || !meta?.years?.length) return

        const interval = setInterval(() => {
            setScatterYear((prev) => {
                const years = meta.years
                const currentIndex = years.indexOf(prev ?? -1)
                const nextIndex = currentIndex + 1

                if (nextIndex >= years.length) {
                    setIsPlaying(false)
                    return prev
                }

                return years[nextIndex]
            })
        }, 800)

        return () => clearInterval(interval)
    }, [isPlaying, meta])

    return (
        <>
            <div
                style={{
                    marginTop: 0,
                    maxWidth: 980,
                    background: '#111827',
                    border: '1px solid #1f2937',
                    borderRadius: 20,
                    padding: 24,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                }}
            >
                <h2
                    style={{
                        marginTop: 0,
                        marginBottom: 20,
                        fontSize: 32,
                        color: '#f8fafc',
                        textAlign: 'center',
                        fontWeight: 700,
                    }}
                >
                    Exploration of Climate Change Factors Over Time
                </h2>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                        gap: 16,
                        marginBottom: 20,
                        alignItems: 'end',
                    }}
                >
                    <label style={{ color: '#cbd5e1', fontSize: 14 }}>
                        <div style={{ marginBottom: 6 }}>X Axis</div>
                        <select
                            value={xMetric}
                            onChange={(e) => setXMetric(e.target.value)}
                            disabled={!meta}
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid #334155',
                                background: '#0f172a',
                                color: '#f8fafc',
                            }}
                        >
                            {(meta?.metrics ?? []).map((m) => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label style={{ color: '#cbd5e1', fontSize: 14 }}>
                        <div style={{ marginBottom: 6 }}>Y Axis</div>
                        <select
                            value={yMetric}
                            onChange={(e) => setYMetric(e.target.value)}
                            disabled={!meta}
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid #334155',
                                background: '#0f172a',
                                color: '#f8fafc',
                            }}
                        >
                            {(meta?.metrics ?? []).map((m) => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label style={{ color: '#cbd5e1', fontSize: 14 }}>
                        <div style={{ marginBottom: 6 }}>Bubble Size</div>
                        <select
                            value={sizeMetric}
                            onChange={(e) => setSizeMetric(e.target.value)}
                            disabled={!meta}
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid #334155',
                                background: '#0f172a',
                                color: '#f8fafc',
                            }}
                        >
                            {(meta?.metrics ?? []).map((m) => (
                                <option key={m} value={m}>
                                    {m}
                                </option>
                            ))}
                        </select>
                    </label>

                    <button
                        type="button"
                        onClick={() => setIsPlaying((prev) => !prev)}
                        style={{
                            padding: '10px 16px',
                            borderRadius: 10,
                            border: '1px solid #2563eb',
                            background: isPlaying ? '#1d4ed8' : '#2563eb',
                            color: '#ffffff',
                            fontWeight: 600,
                            cursor: 'pointer',
                            height: 42,
                        }}
                    >
                        {isPlaying ? 'Pause' : 'Play'}
                    </button>
                </div>

                <div style={{ marginBottom: 18 }}>
                    <div
                        style={{
                            color: '#cbd5e1',
                            marginBottom: 10,
                            textAlign: 'center',
                            fontSize: 16,
                        }}
                    >
                        Year: <strong style={{ color: '#f8fafc' }}>{scatterYear ?? ''}</strong>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={Math.max((meta?.years?.length ?? 1) - 1, 0)}
                        step={1}
                        value={Math.max((meta?.years ?? []).indexOf(scatterYear ?? -1), 0)}
                        onChange={(e) => {
                            const index = Number(e.target.value)
                            const nextYear = meta?.years?.[index]
                            if (typeof nextYear === 'number') {
                                setScatterYear(nextYear)
                            }
                        }}
                        style={{ width: '100%' }}
                        disabled={!meta || (meta?.years?.length ?? 0) === 0}
                    />
                </div>

                {scatterError ? <p style={{ color: '#fca5a5' }}>{scatterError}</p> : null}

                <svg
                    ref={scatterSvgRef}
                    style={{
                        width: '100%',
                        maxWidth: 980,
                        display: 'block',
                        background: '#0f172a',
                        borderRadius: 16,
                        border: '1px solid #1e293b',
                    }}
                />
            </div>

            {scatterTooltip ? (
                <div
                    style={{
                        position: 'fixed',
                        left: scatterTooltip.x + 14,
                        top: scatterTooltip.y + 14,
                        pointerEvents: 'none',
                        background: 'rgba(15, 23, 42, 0.96)',
                        color: '#f8fafc',
                        padding: '10px 12px',
                        borderRadius: 12,
                        fontSize: 12,
                        lineHeight: 1.6,
                        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
                        border: '1px solid #334155',
                        zIndex: 11,
                    }}
                >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{scatterTooltip.country}</div>
                    <div>{xMetric}: {scatterTooltip.xValue.toFixed(2)}</div>
                    <div>{yMetric}: {scatterTooltip.yValue.toFixed(2)}</div>
                    <div>{sizeMetric}: {scatterTooltip.sizeValue.toFixed(2)}</div>
                </div>
            ) : null}
        </>
    )
}

export default BubbleScatterPlot
