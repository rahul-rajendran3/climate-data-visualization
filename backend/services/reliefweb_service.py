from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import os
import threading
from typing import Any, Dict, List, Optional, Tuple

import requests


@dataclass(frozen=True)
class NewsArticle:
    title: str
    url: str
    source: Optional[str] = None
    date: Optional[str] = None


class ReliefWebService:
    """Fetches "latest climate news" from ReliefWeb reports.

    Notes:
    - ReliefWeb requires an approved `appname` (passed in the URL).
    - We cache aggressively because ReliefWeb has daily quotas.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cache: Dict[Tuple[str, int], Tuple[datetime, List[Dict[str, Any]]]] = {}

        backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        data_root = os.path.join(backend_root, "data")
        os.makedirs(data_root, exist_ok=True)
        self._disk_cache_path = os.path.join(data_root, "reliefweb_news_cache.json")
        self._disk_cache: Dict[str, Dict[str, Any]] = {}
        self._load_disk_cache()

    def _cache_key_str(self, cache_key: Tuple[str, int]) -> str:
        country, limit = cache_key
        return f"{country}|{limit}"

    def _load_disk_cache(self) -> None:
        try:
            if not os.path.exists(self._disk_cache_path):
                return
            with open(self._disk_cache_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                self._disk_cache = raw
        except Exception:
            self._disk_cache = {}

    def _save_disk_cache(self) -> None:
        try:
            with open(self._disk_cache_path, "w", encoding="utf-8") as f:
                json.dump(self._disk_cache, f)
        except Exception:
            pass

    def _get_cached(self, cache_key: Tuple[str, int], *, allow_expired: bool = False) -> Optional[List[Dict[str, Any]]]:
        now = datetime.utcnow()
        with self._lock:
            cached = self._cache.get(cache_key)
            if not cached:
                return None
            expires_at, payload = cached
            if expires_at <= now and not allow_expired:
                self._cache.pop(cache_key, None)
                return None
            return payload

    def _set_cached(self, cache_key: Tuple[str, int], payload: List[Dict[str, Any]], *, ttl_seconds: int) -> None:
        expires_at = datetime.utcnow() + timedelta(seconds=ttl_seconds)
        with self._lock:
            self._cache[cache_key] = (expires_at, payload)

            key_str = self._cache_key_str(cache_key)
            self._disk_cache[key_str] = {
                "cachedAt": datetime.utcnow().isoformat() + "Z",
                "payload": payload,
            }

            if len(self._disk_cache) > 800:
                for k in list(self._disk_cache.keys())[:200]:
                    self._disk_cache.pop(k, None)
            self._save_disk_cache()

    def get_cached_latest_climate_news(
        self,
        country: str,
        *,
        limit: int = 5,
        allow_expired: bool = True,
    ) -> Optional[List[Dict[str, Any]]]:
        country = (country or "").strip()
        if not country:
            return None

        limit = max(1, min(int(limit), 10))
        cache_key = (country.lower(), limit)

        mem = self._get_cached(cache_key, allow_expired=allow_expired)
        if mem is not None:
            return mem

        key_str = self._cache_key_str(cache_key)
        with self._lock:
            entry = self._disk_cache.get(key_str)
            if isinstance(entry, dict):
                payload = entry.get("payload")
                if isinstance(payload, list):
                    return payload
        return None

    def _extract_source(self, fields: Dict[str, Any]) -> Optional[str]:
        src = fields.get("source")
        if isinstance(src, dict):
            for key in ("shortname", "name", "longname", "homepage"):
                val = src.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()
            return None
        if isinstance(src, list) and src:
            first = src[0]
            if isinstance(first, dict):
                for key in ("shortname", "name", "longname", "homepage"):
                    val = first.get(key)
                    if isinstance(val, str) and val.strip():
                        return val.strip()
        if isinstance(src, str) and src.strip():
            return src.strip()
        return None

    def _extract_date(self, fields: Dict[str, Any]) -> Optional[str]:
        date_val = fields.get("date")
        if isinstance(date_val, str) and date_val.strip():
            return date_val.strip()
        if isinstance(date_val, dict):
            for key in ("original", "created", "changed"):
                val = date_val.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()
        return None

    def get_latest_climate_news(
        self,
        country: str,
        *,
        limit: int = 5,
        ttl_seconds: int = 60 * 60,
        appname: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return latest ReliefWeb reports for a country matching climate-change keywords."""

        country = (country or "").strip()
        if not country:
            return []

        limit = max(1, min(int(limit), 10))

        cache_key = (country.lower(), limit)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        appname = (appname or os.getenv("RELIEFWEB_APPNAME") or "").strip()
        if not appname:
            raise RuntimeError(
                "RELIEFWEB_APPNAME is not set. "
                "ReliefWeb now requires an approved appname; set RELIEFWEB_APPNAME in backend/.env or backend/.flaskenv."
            )

        endpoint = f"https://api.reliefweb.int/v2/reports?appname={appname}"
        body: Dict[str, Any] = {
            "preset": "latest",
            "profile": "list",
            "slim": True,
            "limit": limit,
            "query": {
                "value": "climate OR \"climate change\" OR emissions OR warming",
            },
            "filter": {
                "field": "country",
                "value": country,
            },
            "fields": {
                "include": [
                    "url",
                    "source",
                    "date",
                ]
            },
        }

        headers = {
            "User-Agent": "climate-data-visualization/1.0",
            "Accept": "application/json",
        }

        resp = requests.post(endpoint, json=body, headers=headers, timeout=15)
        if resp.status_code == 403:
            raise PermissionError(
                "ReliefWeb rejected the configured appname (HTTP 403). "
                "Verify RELIEFWEB_APPNAME is an approved appname."
            )
        resp.raise_for_status()

        raw = resp.json()
        items = raw.get("data") if isinstance(raw, dict) else None
        if not isinstance(items, list):
            return []

        payload: List[Dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            fields = item.get("fields")
            if not isinstance(fields, dict):
                fields = {}

            title = fields.get("title")
            if not isinstance(title, str):
                title = ""
            title = title.strip()

            url = fields.get("url")
            if not isinstance(url, str):
                url = ""
            url = url.strip()

            if not title or not url:
                continue

            payload.append(
                {
                    "title": title,
                    "url": url,
                    "source": self._extract_source(fields),
                    "date": self._extract_date(fields),
                }
            )

        self._set_cached(cache_key, payload, ttl_seconds=ttl_seconds)
        return payload


reliefweb_service = ReliefWebService()
