"""HTTP API for the Heimdal routing engine.

    uvicorn heimdal_routing.api:app --reload
    GET /route?origin=30.7600,76.7680&destination=30.7056,76.8013&hour=22.5&mode=walk
    GET /route?origin=Panjab University&destination=Elante Mall&hour=22
"""
from __future__ import annotations

import os
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query

from .engine import SafeRouter, SafetyGraph

GRAPH_PATH = os.environ.get("HEIMDAL_GRAPH", os.path.join(os.path.dirname(__file__), "..", "data", "tricity_graph.json"))
app = FastAPI(title="Heimdal Safe Routing", version="0.1.0")


@lru_cache(maxsize=1)
def _router() -> SafeRouter:
    return SafeRouter(SafetyGraph.load(GRAPH_PATH))


def _point(s: str, graph: SafetyGraph) -> tuple[float, float]:
    try:
        lat, lon = (float(x) for x in s.split(","))
        return lat, lon
    except ValueError:
        try:
            return graph.find_place(s)
        except KeyError as e:
            raise HTTPException(400, str(e)) from e


@app.get("/health")
def health():
    g = _router().g
    return {"status": "ok", "nodes": len(g.nodes), "edges": len(g.edges), "synthetic": g.meta.get("synthetic", True)}


@app.get("/route")
def route(origin: str, destination: str,
          hour: float = Query(..., ge=0, lt=24), mode: str = Query("walk", pattern="^(walk|drive)$"),
          max_detour: float = Query(1.5, ge=1.0, le=3.0), include_segments: bool = False):
    r = _router()
    try:
        plan = r.plan(_point(origin, r.g), _point(destination, r.g), hour, mode, max_detour)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if not include_segments:
        for rt in plan["routes"].values():
            rt.pop("segments", None)
    return plan
