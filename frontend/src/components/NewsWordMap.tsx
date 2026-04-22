import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

type WordDatum = {
  text: string;
  value: number;
};

type ArticleDatum = {
  title: string;
  url: string;
  source?: string | null;
  date?: string | null;
};

type WordMapResponse = {
  timespan: string;
  maxrecords: number;
  query: string;
  articleCount: number;
  articles: ArticleDatum[];
  words: WordDatum[];
  warning?: string;
};

function isWordMapResponse(value: unknown): value is WordMapResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<WordMapResponse>;
  return (
    typeof v.timespan === "string" &&
    typeof v.maxrecords === "number" &&
    typeof v.query === "string" &&
    typeof v.articleCount === "number" &&
    Array.isArray(v.articles) &&
    Array.isArray(v.words)
  );
}

function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function NewsWordMap() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [data, setData] = useState<WordMapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedWord, setSelectedWord] = useState<string>("");

  const words = useMemo(() => data?.words ?? [], [data]);
  const articles = useMemo(() => data?.articles ?? [], [data]);

  const relatedArticles = useMemo(() => {
    const word = selectedWord.trim().toLowerCase();
    if (!word) return [] as ArticleDatum[];

    const hits = articles.filter((a) =>
      typeof a.title === "string" ? a.title.toLowerCase().includes(word) : false,
    );

    // Keep the UI short.
    return hits.slice(0, 20);
  }, [articles, selectedWord]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const url =
          "http://127.0.0.1:5001/api/climate-news-wordmap?timespan=24h&maxrecords=80&top=60";
        const res = await fetch(url);
        const raw: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          const message = (raw as any)?.error;
          throw new Error(
            typeof message === "string"
              ? message
              : "Failed to load /api/climate-news-wordmap",
          );
        }

        if (!isWordMapResponse(raw)) {
          throw new Error(
            "Unexpected response shape from /api/climate-news-wordmap",
          );
        }

        if (!cancelled) {
          setData(raw);
          setSelectedWord("");
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load climate word map",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;

    const width = 980;
    const height = 560;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    if (!words.length) return;

    const root = d3
      .hierarchy({ children: words } as any)
      .sum((d: any) => (typeof d.value === "number" ? d.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const pack = d3.pack<any>().size([width, height]).padding(4);
    const packed = pack(root);

    const nodes = packed.leaves();

    const g = svg.append("g");

    const node = g
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    node
      .append("circle")
      .attr("r", (d) => d.r)
      .attr("fill", "rgba(255, 255, 255, 0.35)")
      .attr("stroke", "#1565c0")
      .attr("stroke-width", 1);

    node
      .style("cursor", "pointer")
      .on("click", (_event, d: any) => {
        const text = String(d?.data?.text ?? "").trim();
        setSelectedWord((prev) => (prev === text ? "" : text));
      });

    node
      .append("text")
      .text((d) => String(d.data.text ?? ""))
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("pointer-events", "none")
      .attr("fill", "#0d2137")
      .style("font-weight", 700)
      .style("font-size", (d) => {
        const word = String(d.data.text ?? "");
        const byRadius = d.r * 0.62;
        const byLength = word.length ? 130 / (word.length + 2) : 12;
        return `${clamp(9, Math.min(byRadius, byLength), 22)}px`;
      })
      .text((d) => {
        const word = String(d.data.text ?? "");
        const maxChars = Math.floor(d.r / 3.5);
        if (maxChars <= 0) return "";
        if (word.length <= maxChars) return word;
        return `${word.slice(0, Math.max(1, maxChars - 1))}…`;
      });
  }, [words]);

  return (
    <div className="wordmap-layout">
      <div className="wordmap-area">
        <h2>Climate Change News Word Map</h2>
        <p className="wordmap-subtitle">
          {data
            ? `Top terms from ${data.articleCount} recent articles (GDELT, ${data.timespan}).`
            : "Top terms from recent climate-change coverage."}
        </p>

        {data?.warning ? (
          <p className="wordmap-warning">{data.warning}</p>
        ) : null}

        {error ? <p className="wordmap-error">{error}</p> : null}
        {loading ? <p className="wordmap-loading">Loading word map…</p> : null}

        <div className="wordmap-frame">
          <svg ref={svgRef} className="wordmap-svg" />
        </div>
      </div>

      <div className="wordmap-sidebar">
        <h3>Related Articles</h3>
        <div className="wordmap-related">
          {selectedWord ? (
            <>
              <div className="wordmap-related__country">
                Matching: <span>{selectedWord}</span>
              </div>
              {relatedArticles.length ? (
                <ol className="wordmap-related__list">
                  {relatedArticles.map((a) => (
                    <li key={a.url} className="wordmap-related__item">
                      <a
                        className="wordmap-related__link"
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {a.title}
                      </a>
                      {a.source ? (
                        <div className="wordmap-related__meta">{a.source}</div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="wordmap-related__empty">
                  No matching titles in this sample.
                </p>
              )}
            </>
          ) : (
            <p className="wordmap-related__hint">
              Click a bubble to show matching articles.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default NewsWordMap;
