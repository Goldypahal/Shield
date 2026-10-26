import json
import os
import sys

import networkx as nx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from heimdal_routing import synth  # noqa: E402
from heimdal_routing.engine import RiskModel, SafeRouter, SafetyGraph  # noqa: E402

PAIRS = [("Panjab University", "Elante Mall"), ("ISBT", "Elante"), ("Sector 17", "PCA"),
         ("Elante", "Panchkula Sector 5"), ("Railway", "Zirakpur"), ("Fortis", "ISBT")]


@pytest.fixture(scope="module")
def graph():
    return SafetyGraph(synth.to_graph_json(synth.generate()))


def test_generation_is_deterministic():
    a, b = synth.generate(7), synth.generate(7)
    assert [e["inc_night"] for e in a.edges] == [e["inc_night"] for e in b.edges]


def test_network_is_connected(graph):
    G = nx.Graph()
    G.add_edges_from((e["u"], e["v"]) for e in graph.edges)
    assert nx.is_connected(G)
    assert len(graph.nodes) > 800


def test_risk_bounds_and_night_effect(graph):
    m = RiskModel(graph)
    for k in range(0, len(graph.edges), 7):
        day, night = m.edge_risk(k, 12).risk, m.edge_risk(k, 23).risk
        assert 0 <= day <= 1 and 0 <= night <= 1
    mean = lambda h: sum(m.edge_risk(k, h).risk for k in range(len(graph.edges))) / len(graph.edges)  # noqa
    assert mean(23) > mean(12)


@pytest.mark.parametrize("a,b", PAIRS)
@pytest.mark.parametrize("hour", [8, 13, 19.5, 23])
@pytest.mark.parametrize("mode", ["walk", "drive"])
def test_route_invariants(graph, a, b, hour, mode):
    plan = SafeRouter(graph).plan(graph.find_place(a), graph.find_place(b), hour, mode)
    f, s = plan["routes"]["fastest"], plan["routes"]["safest"]
    assert f["nodes"][0] == s["nodes"][0] and f["nodes"][-1] == s["nodes"][-1]
    assert f["duration_s"] <= s["duration_s"] + 1          # fastest is fastest
    assert s["duration_s"] <= 1.5 * f["duration_s"] + 1    # detour budget respected
    assert s["safety_index"] >= f["safety_index"] - 2      # safest is not meaningfully riskier
    if mode == "drive":
        for r in plan["routes"].values():
            assert all(seg["cls"] != "park_path" for seg in r["segments"])


def test_safest_avoids_isolated_stretches_at_night(graph):
    plan = SafeRouter(graph).plan(graph.find_place("ISBT"), graph.find_place("Elante"), 22.5)
    assert plan["routes"]["safest"]["isolated_m"] < plan["routes"]["fastest"]["isolated_m"]


def test_api(graph, tmp_path):
    from fastapi.testclient import TestClient
    p = tmp_path / "g.json"
    p.write_text(json.dumps(synth.to_graph_json(synth.generate())))
    os.environ["HEIMDAL_GRAPH"] = str(p)
    import importlib
    from heimdal_routing import api
    importlib.reload(api)
    c = TestClient(api.app)
    assert c.get("/health").json()["status"] == "ok"
    r = c.get("/route", params={"origin": "Panjab University", "destination": "30.7056,76.8013", "hour": 22})
    assert r.status_code == 200 and "fastest" in r.json()["routes"]
    assert c.get("/route", params={"origin": "Nowhere", "destination": "Elante", "hour": 9}).status_code == 400


def test_osm_adapter_with_fake_osmnx(monkeypatch):
    """Exercise the OSM conversion without network access using an OSMnx-shaped graph."""
    import types
    G = nx.MultiDiGraph()
    pts = {1: (30.7398, 76.7827), 2: (30.7410, 76.7840), 3: (30.7390, 76.7850), 4: (30.7420, 76.7860)}
    for n, (lat, lon) in pts.items():
        G.add_node(n, y=lat, x=lon)
    G.add_edge(1, 2, 0, highway="primary", lit="yes", length=180.0, name="Jan Marg")
    G.add_edge(2, 3, 0, highway="footway", length=200.0)
    G.add_edge(3, 4, 0, highway=["residential", "service"], lit="no", sidewalk="no", length=350.0)
    G.add_edge(1, 3, 0, highway="tertiary", length=250.0)
    fake = types.SimpleNamespace(
        graph_from_bbox=lambda bbox, network_type, simplify: G,
        convert=types.SimpleNamespace(to_undirected=lambda g: g.to_undirected()),
        features_from_bbox=lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline")),
        settings=types.SimpleNamespace(useful_tags_way=["highway", "name"]),
    )
    monkeypatch.setitem(sys.modules, "osmnx", fake)
    from heimdal_routing.osm import build_from_osm
    doc = build_from_osm()
    # real OSMnx strips way tags not in this whitelist, so lit/sidewalk must be requested
    assert {"lit", "sidewalk"} <= set(fake.settings.useful_tags_way)
    g = SafetyGraph(doc)
    assert len(g.edges) == 4
    by_name = {e["name"]: e for e in g.edges}
    assert by_name["Jan Marg"]["lit"] == "yes" and by_name["Jan Marg"]["cls"] == "V2"
    plan = SafeRouter(g).plan(pts[1], pts[4], 22)
    assert plan["routes"]["fastest"]["nodes"][-1] == g.nearest_node(*pts[4])
