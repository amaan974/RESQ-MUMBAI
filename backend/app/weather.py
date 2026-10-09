"""Optional third-party rainfall CONTEXT from Open-Meteo (https://open-meteo.com, CC BY 4.0).
Displayed only; never used to close roads or change decisions. Failure => UNKNOWN / NOT CONNECTED."""
from __future__ import annotations

import datetime as dt
import time

import requests

URL = ("https://api.open-meteo.com/v1/forecast?latitude=19.06&longitude=72.88"
       "&current=precipitation,rain&hourly=precipitation&forecast_hours=6&timezone=Asia%2FKolkata")
TTL_S = 600
_cache: dict = {"at": 0.0, "data": None}


def unknown(reason: str) -> dict:
    return {"status": "unavailable", "label": "UNKNOWN / NOT CONNECTED", "reason": reason}


def cached() -> dict:
    return _cache["data"] or unknown("not fetched yet")


def fetch(force: bool = False, timeout: float = 5.0) -> dict:
    if not force and _cache["data"] and time.monotonic() - _cache["at"] < TTL_S:
        return _cache["data"]
    try:
        r = requests.get(URL, timeout=timeout)
        r.raise_for_status()
        j = r.json()
        hourly = j.get("hourly", {}).get("precipitation", [])
        data = {"status": "ok", "label": "THIRD-PARTY FORECAST · context only",
                "source": "Open-Meteo forecast API (CC BY 4.0), grid point near Kurla",
                "observed_at": j["current"]["time"] + " IST", "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "current_precip_mm": j["current"].get("precipitation"),
                "next_6h_precip_mm": round(sum(x or 0 for x in hourly), 1),
                "note": "Model forecast, not a gauge observation. Not used for routing or closures; flood zones in this demo are hypothetical."}
    except Exception as e:  # network/API failure must never break the dispatcher
        data = unknown(f"fetch failed: {type(e).__name__}")
    _cache["at"], _cache["data"] = time.monotonic(), data
    return data
