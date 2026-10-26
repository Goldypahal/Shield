"""Render a route plan on CARTO or OpenStreetMap tiles with Folium (opens in any browser)."""
from __future__ import annotations

import os

from .engine import SafetyGraph

COLORS = {"fastest": "#2563eb", "balanced": "#a855f7", "safest": "#059669"}


def risk_color(r: float) -> str:
    if r < 0.35:
        return "#16a34a"
    if r < 0.5:
        return "#ca8a04"
    if r < 0.65:
        return "#ea580c"
    return "#dc2626"


def plan_to_map(graph: SafetyGraph, plan: dict, path: str, show_network: bool = False) -> str:
    import folium

    routes = plan["routes"]
    first = routes["fastest"]["coords"]
    # CARTO Voyager when CARTO_API_KEY is set; OpenStreetMap's own tiles otherwise.
    # The key ends up in the saved HTML, so share exported maps accordingly.
    carto_key = os.environ.get("CARTO_API_KEY")
    if carto_key:
        m = folium.Map(location=first[len(first) // 2], zoom_start=14,
                       tiles=f"https://basemaps.cartocdn.com/rastertiles/voyager/{{z}}/{{x}}/{{y}}.png?key={carto_key}",
                       attr="© CARTO © OpenStreetMap contributors")
    else:
        m = folium.Map(location=first[len(first) // 2], zoom_start=14, tiles="OpenStreetMap",
                       attr="© OpenStreetMap contributors")
    if show_network:
        from .engine import RiskModel
        model = RiskModel(graph, plan["mode"])
        net = folium.FeatureGroup("Network risk (synthetic)", show=False)
        for k, e in enumerate(graph.edges):
            a, b = graph.nodes[e["u"]], graph.nodes[e["v"]]
            folium.PolyLine([(a["lat"], a["lon"]), (b["lat"], b["lon"])], weight=2, opacity=0.6,
                            color=risk_color(model.edge_risk(k, plan["hour"]).risk)).add_to(net)
        net.add_to(m)
    for label in ("fastest", "balanced", "safest"):
        if label not in routes:
            continue
        r = routes[label]
        fg = folium.FeatureGroup(f"{label.title()} — {r['duration_s'] / 60:.0f} min, safety {r['safety_index']}")
        tip = (f"<b>{label.title()}</b><br>{r['distance_m']:,} m · {r['duration_s'] / 60:.0f} min<br>"
               f"Safety index {r['safety_index']}/100 · lit {r['lit_pct']}%<br>" + "<br>".join(r["highlights"]))
        folium.PolyLine(r["coords"], color=COLORS[label], weight=7 if label == "safest" else 5,
                        opacity=0.85, tooltip=folium.Tooltip(tip)).add_to(fg)
        fg.add_to(m)
    folium.Marker(first[0], tooltip="Start", icon=folium.Icon(color="blue")).add_to(m)
    folium.Marker(first[-1], tooltip="Destination", icon=folium.Icon(color="green")).add_to(m)
    for p in graph.police:
        folium.CircleMarker((p["lat"], p["lon"]), radius=4, color="#1e3a8a", fill=True,
                            tooltip=p["kind"]).add_to(m)
    folium.LayerControl(collapsed=False).add_to(m)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    m.save(path)
    return path
