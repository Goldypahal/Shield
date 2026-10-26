"""Object-level authorization shared by all routers.

Who may see what:
  * the walker who owns a walk/alert;
  * a guardian whose phone number the walker added *and* who accepted the
    invitation (verified), limited to the walks shared with them;
  * responders and admins (staff), for alerts and walks.

Unauthorized lookups answer 404 rather than 403 so IDs cannot be probed.
"""
from typing import Optional

from fastapi import HTTPException

from db.storage import storage
from security import is_staff

NOT_FOUND = "Not found"


async def guardian_link(user: dict, walker_id: str) -> Optional[dict]:
    """The verified guardian record linking `user` to `walker_id`, if any."""
    if not user.get("phone_verified"):
        return None  # guardianship is keyed on the phone number, so only a proven number counts
    for link in await storage.get_guardianships(user["phone_number"]):
        if link["user_id"] == walker_id:
            return link
    return None


async def can_view_alert(user: dict, alert: dict) -> bool:
    if alert["user_id"] == user["user_id"] or is_staff(user):
        return True
    return await guardian_link(user, alert["user_id"]) is not None


async def can_view_walk(user: dict, walk: dict) -> bool:
    if walk["user_id"] == user["user_id"] or is_staff(user):
        return True
    link = await guardian_link(user, walk["user_id"])
    if not link:
        return False
    shared = walk.get("shared_with") or []
    return not shared or link["id"] in shared


async def alert_for_viewer(user: dict, alert_id: str) -> dict:
    alert = await storage.get_alert_by_id(alert_id)
    if not alert or not await can_view_alert(user, alert):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return alert


async def alert_for_owner(user: dict, alert_id: str) -> dict:
    alert = await storage.get_alert_by_id(alert_id)
    if not alert or alert["user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return alert


async def walk_for_viewer(user: dict, walk_id: str) -> dict:
    walk = await storage.get_walk(walk_id)
    if not walk or not await can_view_walk(user, walk):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return walk


async def walk_for_owner(user: dict, walk_id: str) -> dict:
    walk = await storage.get_walk(walk_id)
    if not walk or walk["user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return walk


async def channel_for_viewer(user: dict, channel_id: str) -> str:
    """Resolves a live channel id (walk or alert) the user may subscribe to; returns its kind."""
    walk = await storage.get_walk(channel_id)
    if walk and await can_view_walk(user, walk):
        return "walk"
    alert = await storage.get_alert_by_id(channel_id)
    if alert and await can_view_alert(user, alert):
        return "alert"
    raise HTTPException(status_code=404, detail=NOT_FOUND)
