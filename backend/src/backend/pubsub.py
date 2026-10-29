"""In-memory pub/sub hub for real-time ticket updates via SSE.

Each ticket has its own set of subscriber queues. Whenever a comment is posted
or the ticket's status changes the router calls `publish(ticket_id, event)` and
every connected SSE client receives the event as a JSON-encoded SSE message.

The hub lives in application state so the same instance is shared across all
requests in the process. No persistence, no cross-process delivery — that is
fine for a single-replica deployment; if you ever scale horizontally, swap this
for a Redis Pub/Sub channel.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any
from uuid import UUID


class PubSubHub:
    def __init__(self) -> None:
        # ticket_id -> set of queues belonging to active SSE subscribers.
        self._subscribers: dict[UUID, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(
            set
        )

    def subscribe(self, ticket_id: UUID) -> asyncio.Queue[dict[str, Any]]:
        """Register a new SSE connection for *ticket_id*; return its queue."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self._subscribers[ticket_id].add(q)
        return q

    def unsubscribe(self, ticket_id: UUID, q: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove the queue when the client disconnects."""
        subs = self._subscribers.get(ticket_id)
        if subs:
            subs.discard(q)
            if not subs:
                del self._subscribers[ticket_id]

    async def publish(self, ticket_id: UUID, event: dict[str, Any]) -> None:
        """Broadcast *event* to all SSE clients subscribed to *ticket_id*."""
        subs = self._subscribers.get(ticket_id)
        if not subs:
            return
        # Put on every queue; drop the event for a slow client rather than blocking.
        for q in list(subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # client is too slow – we skip this event for them


# Singleton shared across the app (set in lifespan, retrieved via `get_hub`).
_hub: PubSubHub | None = None


def get_hub_instance() -> PubSubHub:
    """Return the hub, creating it on first call (useful in tests)."""
    global _hub
    if _hub is None:
        _hub = PubSubHub()
    return _hub
