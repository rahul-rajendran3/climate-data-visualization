from __future__ import annotations

import re
from typing import Any, Dict, List

import requests

class GdeltService:
    """Fetch recent climate change coverage from the GDELT DOC API.
    """

    _endpoint = "https://api.gdeltproject.org/api/v2/doc/doc"

    def get_latest_climate_articles(
        self,
        *,
        maxrecords: int = 80,
        timespan: str = "24h",
        sourcelang: str = "english",
    ) -> List[Dict[str, Any]]:
        """Return latest climate-related articles (title/url/source/date)."""

        maxrecords = max(1, min(int(maxrecords), 250))
        timespan = (timespan or "").strip() or "1week"

        q = (
            '("climate change" OR "global warming" OR emissions OR decarbonization OR "greenhouse gas" OR "fossil fuels") '
            f"sourcelang:{sourcelang}"
        )

        params = {
            "query": q,
            "mode": "artlist",
            "format": "json",
            "sort": "HybridRel",
            "maxrecords": str(maxrecords),
            "timespan": timespan,
        }

        headers = {
            "User-Agent": "climate-data-visualization/1.0",
            "Accept": "application/json",
        }

        resp = requests.get(self._endpoint, params=params, headers=headers, timeout=12)
        resp.raise_for_status()

        raw = resp.json()
        articles = raw.get("articles") if isinstance(raw, dict) else None
        if not isinstance(articles, list):
            return []

        payload: List[Dict[str, Any]] = []
        for item in articles:
            if not isinstance(item, dict):
                continue

            title = item.get("title")
            url = item.get("url")
            if not isinstance(title, str) or not isinstance(url, str):
                continue

            title = title.strip()
            url = url.strip()
            if not title or not url:
                continue

            source = item.get("domain")
            if isinstance(source, str):
                source = source.strip() or None
            else:
                source = None

            date = item.get("seendate")
            if isinstance(date, str):
                date = date.strip() or None
            else:
                date = None

            payload.append({"title": title, "url": url, "source": source, "date": date})
        return payload


gdelt_service = GdeltService()


_word_re = re.compile(r"[a-zA-Z][a-zA-Z0-9']+")


def extract_top_words(
    titles: List[str],
    *,
    top: int = 60,
) -> List[Dict[str, Any]]:
    """Extract a simple word frequency list from article titles."""

    stopwords = {
        # English stopwords
        "the",
        "and",
        "for",
        "with",
        "from",
        "that",
        "this",
        "into",
        "over",
        "after",
        "before",
        "about",
        "more",
        "most",
        "will",
        "what",
        "when",
        "where",
        "why",
        "how",
        "who",
        "says",
        "say",
        "said",
        "new",
        "as",
        "at",
        "by",
        "on",
        "in",
        "of",
        "to",
        "a",
        "an",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "it",
        "its",
        "their",
        "our",
        "your",
        "his",
        "her",
        "they",
        "them",
        "we",
        "you",
        "i",
        "us",
        "can",
        "could",
        "should",
        "would",
        "may",
        "might",
        "must",
        "not",
        "no",
        "yes",
        "up",
        "down",
        "out",
        "than",
        "then",
        "now",
        # Domain-specific stopwords so the cloud isn't dominated by the query itself
        "climate",
        "change",
        "warming",
        "global",
        "greenhouse",
        "gas",
        "emissions",
    }

    counts: Dict[str, int] = {}

    for title in titles:
        if not isinstance(title, str):
            continue
        text = title.lower()
        for match in _word_re.findall(text):
            word = match.strip("'")
            if len(word) < 3:
                continue
            if word in stopwords:
                continue
            # Skip long numeric-looking tokens
            if word.isdigit():
                continue

            counts[word] = counts.get(word, 0) + 1

    top = max(1, min(int(top), 120))
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top]

    return [{"text": w, "value": c} for (w, c) in items]
