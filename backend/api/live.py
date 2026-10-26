"""In-process fan-out of live location updates to WebSocket subscribers.

One channel per walk or alert id. Works for a single API process; running
several workers needs the Redis pub/sub backend (see docs/ROADMAP.md).
"""
from typing import Any, Dict, List

from fastapi import WebSocket


class LiveBroker:
    def __init__(self):
        self._channels: Dict[str, List[WebSocket]] = {}

    async def register(self, channel: str, ws: WebSocket):
        self._channels.setdefault(channel, []).append(ws)

    async def unregister(self, channel: str, ws: WebSocket):
        subs = self._channels.get(channel)
        if subs and ws in subs:
            subs.remove(ws)
            if not subs:
                del self._channels[channel]

    def subscriber_count(self, channel: str) -> int:
        return len(self._channels.get(channel, []))

    async def broadcast(self, channel: str, data: Dict[str, Any]):
        dead = []
        for ws in list(self._channels.get(channel, [])):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.unregister(channel, ws)


broker = LiveBroker()
