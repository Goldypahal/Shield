"""Refreshes data/safe_havens.json from OpenStreetMap (Overpass API).

    python fetch_safe_havens.py data/safe_havens.json
"""
import json, sys, urllib.request, urllib.parse
q = """[out:json][timeout:90];
(
  nwr["amenity"~"^(police|hospital|pharmacy|fuel)$"](30.60,76.66,30.80,76.92);
);
out center tags;"""
req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(),
                             headers={"User-Agent": "SHIELD-safe-havens/1.0 (safety app dev)"})
data = json.load(urllib.request.urlopen(req, timeout=120))
out = []
for el in data["elements"]:
    t = el.get("tags", {})
    lat = el.get("lat") or el.get("center", {}).get("lat")
    lon = el.get("lon") or el.get("center", {}).get("lon")
    if lat is None:
        continue
    out.append({"kind": t["amenity"], "name": t.get("name") or t.get("name:en") or "",
                "lat": round(lat, 6), "lon": round(lon, 6),
                "opening_hours": t.get("opening_hours"), "phone": t.get("phone") or t.get("contact:phone"),
                "open_24_7": t.get("opening_hours") == "24/7" or t["amenity"] in ("police", "hospital")})
doc = {"source": "OpenStreetMap contributors (ODbL), via Overpass API", "bbox": [30.60, 76.66, 30.80, 76.92], "places": out}
json.dump(doc, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=0)
from collections import Counter
print(len(out), Counter(p["kind"] for p in out))
