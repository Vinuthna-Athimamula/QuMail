from __future__ import annotations

import base64
import os
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any


def _now_ts() -> float:
    return time.time()


@dataclass
class QKDBuffer:
    session_id: str
    user_a: str
    user_b: str
    total_bytes: int
    created_at: float
    expires_at: float
    bytes_data: bytearray
    consumed_bytes: int = 0

    @property
    def available_bytes(self) -> int:
        return max(0, self.total_bytes - self.consumed_bytes)

    def consume(self, requested_bytes: int) -> tuple[bytes, int]:
        available = self.available_bytes
        if available <= 0:
            return b"", self.consumed_bytes

        count = min(requested_bytes, available)
        start = self.consumed_bytes
        end = start + count
        chunk = bytes(self.bytes_data[start:end])
        self.consumed_bytes = end
        return chunk, start


class QKDService:
    def __init__(
        self,
        presence_ttl_seconds: int = 60,
        max_buffer_mb: int = 128,
        session_ttl_seconds: int = 3600,
    ) -> None:
        self.presence_ttl_seconds = presence_ttl_seconds
        self.max_buffer_mb = max_buffer_mb
        self.session_ttl_seconds = session_ttl_seconds

        self._active_users: dict[str, dict[str, Any]] = {}
        self._sessions: dict[str, QKDBuffer] = {}
        self._lock = threading.RLock()

    def _purge_expired(self) -> None:
        now = _now_ts()
        active_cutoff = now - self.presence_ttl_seconds
        self._active_users = {
            user_id: entry
            for user_id, entry in self._active_users.items()
            if float(entry.get("seen_at", 0)) >= active_cutoff
        }
        self._sessions = {
            session_id: session
            for session_id, session in self._sessions.items()
            if session.expires_at >= now
        }

    def mark_active(self, user_id: str, label: str | None = None) -> dict[str, Any]:
        user_id = user_id.strip()
        if not user_id:
            raise ValueError("user_id is required")

        with self._lock:
            self._purge_expired()
            seen_at = _now_ts()
            display = (label or "").strip() or user_id
            self._active_users[user_id] = {
                "seen_at": seen_at,
                "label": display,
            }
            peers = self.list_active_users(exclude_user_id=user_id)
            return {
                "user_id": user_id,
                "active": True,
                "presence_ttl_seconds": self.presence_ttl_seconds,
                "active_users": peers,
            }

    def heartbeat(self, user_id: str, label: str | None = None) -> dict[str, Any]:
        return self.mark_active(user_id=user_id, label=label)

    def list_active_users(self, exclude_user_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            self._purge_expired()
            now = _now_ts()
            users = []
            for user_id, entry in self._active_users.items():
                if exclude_user_id and user_id == exclude_user_id:
                    continue
                users.append(
                    {
                        "user_id": user_id,
                        "label": str(entry.get("label", user_id)),
                        "last_seen_seconds": int(max(0, now - float(entry.get("seen_at", now)))),
                    }
                )
            users.sort(key=lambda item: item.get("label", ""))
            return users

    def _pair_key(self, user_a: str, user_b: str) -> tuple[str, str]:
        return tuple(sorted([user_a, user_b]))  # type: ignore[return-value]

    def _find_pair_session(self, user_id: str, peer_user_id: str) -> QKDBuffer | None:
        pair = self._pair_key(user_id, peer_user_id)
        for session in self._sessions.values():
            if self._pair_key(session.user_a, session.user_b) == pair and session.expires_at >= _now_ts():
                return session
        return None

    def create_session(self, user_id: str, peer_user_id: str, target_mb: int = 100) -> dict[str, Any]:
        user_id = user_id.strip()
        peer_user_id = peer_user_id.strip()
        if not user_id or not peer_user_id:
            raise ValueError("Both user_id and peer_user_id are required")
        if user_id == peer_user_id:
            raise ValueError("peer_user_id must be different from user_id")
        pair = self._pair_key(user_id, peer_user_id)

        with self._lock:
            self._purge_expired()
            if user_id not in self._active_users or peer_user_id not in self._active_users:
                raise ValueError("Both accounts must be active at the same time to start QKD")
            requested_mb = max(1, min(target_mb, self.max_buffer_mb))
            requested_bytes = requested_mb * 1024 * 1024

            existing = self._find_pair_session(user_id, peer_user_id)
            if existing and existing.available_bytes > 0:
                return self.session_status(existing.session_id)

            session_id = str(uuid.uuid4())
            key_material = bytearray(os.urandom(requested_bytes))
            created_at = _now_ts()
            session = QKDBuffer(
                session_id=session_id,
                user_a=pair[0],
                user_b=pair[1],
                total_bytes=requested_bytes,
                created_at=created_at,
                expires_at=created_at + self.session_ttl_seconds,
                bytes_data=key_material,
            )
            self._sessions[session_id] = session
            return self.session_status(session_id)

    def refill_session(self, user_id: str, peer_user_id: str, add_mb: int) -> dict[str, Any]:
        user_id = user_id.strip()
        peer_user_id = peer_user_id.strip()
        if not user_id or not peer_user_id:
            raise ValueError("Both user_id and peer_user_id are required")
        if user_id == peer_user_id:
            raise ValueError("peer_user_id must be different from user_id")
        if add_mb <= 0:
            raise ValueError("add_mb must be greater than 0")

        with self._lock:
            self._purge_expired()
            if user_id not in self._active_users or peer_user_id not in self._active_users:
                raise ValueError("Both accounts must be active at the same time to refill QKD")
            add_mb = min(add_mb, self.max_buffer_mb)
            add_bytes = add_mb * 1024 * 1024

            session = self._find_pair_session(user_id, peer_user_id)
            if not session:
                return self.create_session(user_id=user_id, peer_user_id=peer_user_id, target_mb=add_mb)

            session.bytes_data.extend(os.urandom(add_bytes))
            session.total_bytes += add_bytes
            session.expires_at = _now_ts() + self.session_ttl_seconds
            return self.session_status(session.session_id)

    def pair_status(self, user_id: str, peer_user_id: str) -> dict[str, Any] | None:
        with self._lock:
            self._purge_expired()
            session = self._find_pair_session(user_id, peer_user_id)
            if not session:
                return None
            return self.session_status(session.session_id)

    def session_status(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            self._purge_expired()
            session = self._sessions.get(session_id)
            if not session:
                raise ValueError("QKD session not found or expired")
            return {
                "session_id": session.session_id,
                "user_a": session.user_a,
                "user_b": session.user_b,
                "total_bytes": session.total_bytes,
                "available_bytes": session.available_bytes,
                "consumed_bytes": session.consumed_bytes,
                "created_at": session.created_at,
                "expires_at": session.expires_at,
            }

    def consume_key_chunk(self, session_id: str, user_id: str, chunk_bytes: int) -> dict[str, Any]:
        user_id = user_id.strip()
        if chunk_bytes <= 0:
            raise ValueError("chunk_bytes must be greater than 0")

        with self._lock:
            self._purge_expired()
            session = self._sessions.get(session_id)
            if not session:
                raise ValueError("QKD session not found or expired")
            if user_id not in {session.user_a, session.user_b}:
                raise ValueError("user_id is not part of this QKD session")

            chunk, offset = session.consume(chunk_bytes)
            if not chunk:
                raise ValueError("No QKD bytes available in session. Refill is required.")
            encoded = base64.b64encode(chunk).decode("utf-8") if chunk else ""
            return {
                "session_id": session.session_id,
                "offset": offset,
                "chunk_size": len(chunk),
                "chunk_b64": encoded,
                "available_bytes": session.available_bytes,
                "consumed_bytes": session.consumed_bytes,
            }

    def read_key_chunk(self, session_id: str, user_id: str, offset: int, chunk_bytes: int) -> dict[str, Any]:
        user_id = user_id.strip()
        if offset < 0:
            raise ValueError("offset must be non-negative")
        if chunk_bytes <= 0:
            raise ValueError("chunk_bytes must be greater than 0")

        with self._lock:
            self._purge_expired()
            session = self._sessions.get(session_id)
            if not session:
                raise ValueError("QKD session not found or expired")
            if user_id not in {session.user_a, session.user_b}:
                raise ValueError("user_id is not part of this QKD session")

            end = offset + chunk_bytes
            if end > session.total_bytes:
                raise ValueError("Requested key chunk is outside QKD session bounds")

            chunk = bytes(session.bytes_data[offset:end])
            if not chunk:
                raise ValueError("Requested QKD key chunk is empty")

            return {
                "session_id": session.session_id,
                "offset": offset,
                "chunk_size": len(chunk),
                "chunk_b64": base64.b64encode(chunk).decode("utf-8"),
                "available_bytes": session.available_bytes,
                "consumed_bytes": session.consumed_bytes,
            }
