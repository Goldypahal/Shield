# Heimdal SafeRoute: Tricity routing engine

Fastest, safest and balanced routes for Chandigarh, Mohali, Panchkula and Zirakpur,
with a synthetic safety dataset for development and an adapter for real OpenStreetMap geometry.

> **All safety attributes in `data/` are synthetic.** The road network follows the real
> orientation and extent of the Tricity sector grid and landmarks sit near their real
> coordinates, but lighting, footfall, CCTV, police posts and incidents are simulated.
> Use this to build and test the engine, not to advise anyone about a real street.

## Quick start

```bash
pip install -r requirements.txt
python -m heimdal_routing generate --out data                 # synthetic dataset (deterministic, seed 2026)
python -m heimdal_routing route "ISBT" "Elante" --hour 22.5 --map out/route.html
python -m heimdal_routing route 30.7600,76.7680 30.7056,76.8013 --hour 9 --mode drive
uvicorn heimdal_routing.api:app --reload                      # GET /route?origin=..&destination=..&hour=..
python -m pytest -q                                            # 54 tests
python web/build_web.py                                        # rebuild the browser explorer
```

`--map` writes a Folium page on **OpenStreetMap tiles** with the three routes, the
risk-coloured network (toggle) and police posts.

To route on **real OSM geometry** (needs internet for Overpass):

```bash
python -m heimdal_routing osm --out data/tricity_osm_walk.json --network walk
python -m heimdal_routing route "Sector 17" "Elante" --hour 22 --graph data/tricity_osm_walk.json --map out/real.html
```

The adapter takes geometry, road class, names, `lit=*`, `sidewalk=*` and `amenity=police`
from OSM, and fills everything OSM does not have from the synthetic model.

## Layout

| Path | What it is |
|---|---|
| `heimdal_routing/geo.py` | Rotated sector-grid frame (u = SE along Madhya Marg, v = SW along Jan Marg), lat/lon conversion |
| `heimdal_routing/synth.py` | Synthetic dataset generator |
| `heimdal_routing/engine.py` | Risk model, A*, λ-sweep, fastest / safest / balanced selection, explanations |
| `heimdal_routing/osm.py` | Real OSM geometry → same graph schema, with synthetic overlays |
| `heimdal_routing/mapviz.py` | Folium export on OpenStreetMap tiles |
| `heimdal_routing/api.py` | FastAPI service |
| `web/engine.js` | JavaScript port of the engine (verified identical on 56 cases) |
| `web/explorer.template.html` | Interactive explorer page (Leaflet) |
| `data/` | Generated dataset: `tricity_graph.json`, `edges.csv`, `edges.geojson`, `nodes.csv`, `incidents.csv`, `police_posts.csv`, `landmarks.csv` |

## Synthetic data design

**Network.** A 400 m lattice in the rotated grid frame, cut into zones: Chandigarh
(sectors 800 m × 1200 m), Mohali (continuation of the grid), Panchkula, Zirakpur (jittered,
irregular), the Industrial Area and IT Park/Manimajra belt. Sukhna Lake, the airport and the
railway corridor are holes; the railway is crossed only by two over-bridges. Highways link
Zirakpur to Chandigarh, Mohali (Airport Road) and Panchkula. Result: 1,030 junctions,
2,064 segments, one connected component.

**Road classes** follow Chandigarh's V-road hierarchy: V2 arterials, V3 sector boundaries,
V4 shopping streets, V5 internal roads, plus `park_path` (Leisure Valley, Sukhna promenade and
neighbourhood-park diagonals that are ~29% shorter than walking around), `hwy` and `bridge`.
Park diagonals are deliberate: short by day, dark and empty at night, which is exactly the
trade-off the engine must handle.

**Per-segment attributes** (`edges.csv`):

| Field | Generation |
|---|---|
| `landuse` | residential, commercial, institutional, industrial, office, park, forest, transit, hospital, highway, from zone, sector and landmark proximity |
| `lamps_per_100m`, `lit` | class × zone density × noise; 7% outages (14% in Zirakpur); recorded as `unknown` with probability ∝ (1 − confidence) |
| `footfall_mult` | multiplies a 24-hour land-use profile (e.g. commercial peaks 18–20 h, parks at dawn and dusk, transit and hospitals 24 h) |
| `cctv_per_km` | by land use, more on V2 |
| `police_dist_m` | distance to the nearest synthetic police post or PCR point |
| `sidewalk` | by class, lower in Zirakpur and industrial areas |
| `confidence` | data-coverage score by zone (Chandigarh 0.86 → Zirakpur 0.45) |
| `inc_day / inc_evening / inc_night` | Poisson counts over 3 simulated years from a hidden hazard field |

**Incident hazard** (per km-year): `0.18 · (1 + 2.2·(1−L)·dark) · (1 + 1.6·(1−footfall)) · landuse_factor · (1 + hotspots) · exp(−police_dist/2.5 km)`,
with nine random hotspots. The engine never sees this formula, only the sampled counts,
so the test is whether it can recover risk from noisy observations the way it would from real reports.

## Engine design

**Edge risk** for hour *t*, in [0, 1]:

```
walk:  r = 0.28·dark(t)·(1−L) + 0.22·(1−F(t)) + 0.08·(1−C) + 0.12·(1−P) + 0.20·I + 0.10·(1−S)
drive: r = 0.30·dark(t)·(1−L) + 0.12·(1−F(t)) + 0.10·(1−C) + 0.18·(1−P) + 0.30·I
```

* `L` lighting = lamps/2.5; unknown lighting uses a cautious class prior (0.8 × expected)
* `F` footfall = land-use profile(t) × multiplier; `C` CCTV = 1 − e^(−cams/4); `P` police = e^(−d/700 m)
* `I` incidents: empirical-Bayes rate `(k + 0.5) / (km·years·period_share + 1)`, then 1 − e^(−rate/1.2)
* `dark(t)` follows late-October sunrise and sunset for the Tricity
* A segment is **isolated** when dark > 0.5, F < 0.15 and L < 0.4

**Cost and search.** `c_λ = time · (1 + λ·(r + 0.15·uncertainty + 0.25·isolated))`. A* with a
haversine/vmax heuristic (admissible because the multiplier ≥ 1) runs for
λ ∈ {0, 0.5, 1, 2, 3.5, 5, 8, 12, 20}. λ = 0 is the **fastest** route. Among candidates within
the detour budget (default 1.5× fastest time) the lowest length-weighted risk is the **safest**;
the knee of the time–risk Pareto front is **balanced**. A plan takes ~10 ms in Python and ~3 ms in JS.

**Output** per route: distance, duration, safety index (100 × (1 − mean risk)), max risk,
% on recorded lit roads, % unknown lighting, metres of dark isolated stretches, park-path metres,
police posts within 300 m, incidents for the period, data confidence, main roads and plain-language
reasons it differs from the fastest route.

**Example** (`ISBT 43 → Elante`, walking, 22:30): fastest 73 min, safety 55, 1.7 km dark and
isolated; safest 80 min, safety 68, none isolated, 81% lit vs 63%. At 13:00 the gap shrinks to
safety 70 vs 78, since lighting stops counting.

## Moving from synthetic to real data

1. Geometry: `osm.py` already uses real OSM; add OSM `landuse` polygons instead of the zone rules.
2. Lighting: municipal streetlight GIS or a night-time survey; keep `unknown` where there is no data.
3. Footfall: anonymised, aggregated mobility counts. Never individual traces.
4. Incidents: verified police open data or moderated reports, with abuse protection.
5. Calibrate weights against outcomes before claiming anything; keep the "synthetic" flag until then.
6. Never label a route "safe". Show the safety index, the evidence and the data confidence.
