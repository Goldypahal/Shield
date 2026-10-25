"""Command line entry point.

    python -m heimdal_routing generate --out data
    python -m heimdal_routing route "Panjab University" "Elante Mall" --hour 22.5 --map route.html
    python -m heimdal_routing route 30.7600,76.7680 30.7056,76.8013 --hour 9 --mode drive
    python -m heimdal_routing osm --out data/tricity_osm_walk.json --network walk     (needs internet)
"""
from __future__ import annotations

import argparse
import json

from .engine import SafeRouter, SafetyGraph


def _pt(s: str, g: SafetyGraph):
    try:
        a, b = s.split(",")
        return float(a), float(b)
    except ValueError:
        return g.find_place(s)


def main() -> None:
    p = argparse.ArgumentParser(prog="heimdal_routing")
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="write the synthetic Tricity dataset")
    g.add_argument("--out", default="data")
    g.add_argument("--seed", type=int, default=2026)
    r = sub.add_parser("route", help="plan fastest / safest routes")
    r.add_argument("origin")
    r.add_argument("destination")
    r.add_argument("--hour", type=float, required=True)
    r.add_argument("--mode", choices=["walk", "drive"], default="walk")
    r.add_argument("--graph", default="data/tricity_graph.json")
    r.add_argument("--max-detour", type=float, default=1.5)
    r.add_argument("--map", help="write an OpenStreetMap HTML map here")
    r.add_argument("--json", action="store_true")
    o = sub.add_parser("osm", help="build a graph from real OSM geometry (needs internet)")
    o.add_argument("--out", required=True)
    o.add_argument("--network", choices=["walk", "drive"], default="walk")
    a = p.parse_args()

    if a.cmd == "generate":
        from .synth import write_all
        ds = write_all(a.out, a.seed)
        print(f"Wrote {len(ds.nodes)} nodes, {len(ds.edges)} edges, {len(ds.incidents)} incidents to {a.out}/")
    elif a.cmd == "osm":
        from .osm import build_from_osm
        doc = build_from_osm(network_type=a.network)
        with open(a.out, "w") as f:
            json.dump(doc, f)
        print(f"Wrote {len(doc['nodes'])} nodes, {len(doc['edges'])} edges to {a.out}")
    else:
        graph = SafetyGraph.load(a.graph)
        plan = SafeRouter(graph).plan(_pt(a.origin, graph), _pt(a.destination, graph), a.hour, a.mode, a.max_detour)
        if a.json:
            print(json.dumps(plan, indent=2, default=str))
        else:
            for label, rt in plan["routes"].items():
                print(f"{label.upper():9} {rt['distance_m']:>6,} m  {rt['duration_s'] / 60:5.1f} min  "
                      f"safety {rt['safety_index']:>3}/100  lit {rt['lit_pct']:>5}%  isolated {rt['isolated_m']:>5} m  "
                      f"via {', '.join(rt['main_roads']) or 'sector roads'}")
                for h in rt["highlights"]:
                    print(f"          - {h}")
            for n in plan["notes"]:
                print("note:", n)
        if a.map:
            from .mapviz import plan_to_map
            print("map:", plan_to_map(graph, plan, a.map, show_network=True))


if __name__ == "__main__":
    main()
