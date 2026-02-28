from __future__ import annotations

import asyncio
import math
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from .config import settings
from .gmail_client import GmailClient
from .qkd_service import QKDService
from .supabase_client import SupabaseRepository
from .sync_service import SyncService

repo = SupabaseRepository()
gmail = GmailClient()
sync_service = SyncService(repo, gmail)
qkd_service = QKDService(
    presence_ttl_seconds=settings.qkd_presence_ttl_seconds,
    max_buffer_mb=settings.qkd_max_buffer_mb,
    session_ttl_seconds=settings.qkd_session_ttl_seconds,
)


class AuthUrlResponse(BaseModel):
    user_id: str
    auth_url: str


class ConnectRequest(BaseModel):
    user_id: str
    code: str


class SyncResponse(BaseModel):
    email: str | None = None
    synced: int = 0
    history_id: str | None = None
    error: str | None = None


class SendMailRequest(BaseModel):
    user_id: str
    user_email: str | None = None
    to: str
    subject: str
    body: str


class AuthRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str


class LogoutRequest(BaseModel):
    access_token: str | None = None


class PresenceRequest(BaseModel):
    user_id: str
    user_email: str | None = None
    username: str | None = None


class QKDSessionRequest(BaseModel):
    user_id: str
    peer_user_id: str
    target_mb: int = 100


class QKDConsumeRequest(BaseModel):
    user_id: str
    chunk_bytes: int = 4096


class QKDRefillRequest(BaseModel):
    user_id: str
    peer_user_id: str
    target_mb: int = 100


class QKDReadRequest(BaseModel):
    user_id: str
    offset: int
    chunk_bytes: int


class BackgroundSync:
    def __init__(self, interval_seconds: int) -> None:
        self.interval_seconds = interval_seconds
        self.task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def run(self) -> None:
        while not self._stop.is_set():
            try:
                sync_service.sync_all()
            except Exception:
                pass
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.interval_seconds)
            except TimeoutError:
                continue

    async def start(self) -> None:
        self.task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        self._stop.set()
        if self.task:
            await self.task


sync_runner = BackgroundSync(interval_seconds=settings.sync_interval_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await sync_runner.start()
    yield
    await sync_runner.stop()


app = FastAPI(title="QuMail Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/qkd/presence/heartbeat")
def qkd_presence_heartbeat(req: PresenceRequest):
    try:
        label = (req.user_email or req.username or req.user_id)
        return qkd_service.mark_active(req.user_id, label=label)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/qkd/activity/ping")
def qkd_activity_ping(req: PresenceRequest):
    try:
        label = (req.user_email or req.username or req.user_id)
        return qkd_service.mark_active(req.user_id, label=label)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/qkd/activity/active")
def qkd_activity_active(exclude_user_id: str | None = None):
    try:
        return {"active_users": qkd_service.list_active_users(exclude_user_id=exclude_user_id)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/qkd/presence/active")
def qkd_list_active(exclude_user_id: str | None = None):
    try:
        return {"active_users": qkd_service.list_active_users(exclude_user_id=exclude_user_id)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/qkd/peers")
def qkd_list_peers(user_id: str, q: str | None = None, active_only: bool = True, limit: int = 30):
    try:
        peers = repo.search_qkd_peers_by_email(user_id=user_id, query=q, limit=limit)
        active = qkd_service.list_active_users(exclude_user_id=user_id)
        active_map = {item.get("user_id"): item for item in active}

        merged = []
        for peer in peers:
            active_item = active_map.get(peer["user_id"])
            online = bool(active_item)
            if active_only and not online:
                continue
            merged.append(
                {
                    "user_id": peer["user_id"],
                    "email": peer["email"],
                    "label": peer["email"],
                    "online": online,
                    "last_seen_seconds": active_item.get("last_seen_seconds") if active_item else None,
                    "last_sync_at": peer.get("last_sync_at"),
                    "last_sign_in_at": peer.get("last_sign_in_at"),
                }
            )
        merged.sort(key=lambda item: (not bool(item.get("online")), str(item.get("email") or "")))
        return {"peers": merged}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/qkd/session/initiate")
def qkd_initiate_session(req: QKDSessionRequest):
    try:
        return qkd_service.create_session(user_id=req.user_id, peer_user_id=req.peer_user_id, target_mb=req.target_mb)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/qkd/session/pair")
def qkd_pair_status(user_id: str, peer_user_id: str):
    try:
        status = qkd_service.pair_status(user_id=user_id, peer_user_id=peer_user_id)
        return {"session": status}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/qkd/session/{session_id}")
def qkd_session_status(session_id: str):
    try:
        return qkd_service.session_status(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/qkd/session/{session_id}/consume")
def qkd_consume_chunk(session_id: str, req: QKDConsumeRequest):
    try:
        return qkd_service.consume_key_chunk(session_id=session_id, user_id=req.user_id, chunk_bytes=req.chunk_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/qkd/session/{session_id}/reserve")
def qkd_reserve_chunk(session_id: str, req: QKDConsumeRequest):
    try:
        return qkd_service.consume_key_chunk(session_id=session_id, user_id=req.user_id, chunk_bytes=req.chunk_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/qkd/session/{session_id}/chunk")
def qkd_read_chunk(session_id: str, req: QKDReadRequest):
    try:
        return qkd_service.read_key_chunk(
            session_id=session_id,
            user_id=req.user_id,
            offset=req.offset,
            chunk_bytes=req.chunk_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/qkd/session/refill")
def qkd_refill_session(req: QKDRefillRequest):
    try:
        estimated_bytes = repo.estimate_pair_mail_bytes(user_id=req.user_id, peer_user_id=req.peer_user_id)
        estimated_mb = max(1, math.ceil((estimated_bytes * 2) / (1024 * 1024)))
        target_mb = max(req.target_mb, estimated_mb)

        current = qkd_service.pair_status(req.user_id, req.peer_user_id)
        available_bytes = int(current.get("available_bytes", 0)) if current else 0
        desired_bytes = target_mb * 1024 * 1024
        missing_bytes = max(0, desired_bytes - available_bytes)
        add_mb = max(1, math.ceil(missing_bytes / (1024 * 1024))) if missing_bytes > 0 else 0

        if add_mb == 0 and current:
            session = current
        else:
            session = qkd_service.refill_session(user_id=req.user_id, peer_user_id=req.peer_user_id, add_mb=max(1, add_mb))

        return {
            "estimated_mail_bytes": estimated_bytes,
            "estimated_target_mb": target_mb,
            "added_mb": 0 if add_mb == 0 and current else max(1, add_mb),
            "session": session,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/oauth/url", response_model=AuthUrlResponse)
def oauth_url(user_id: str):
    state = f"qumail:{user_id}"
    return AuthUrlResponse(user_id=user_id, auth_url=gmail.create_auth_url(state=state))


@app.get("/account/{user_id}")
def account_status(user_id: str, email: str | None = None):
    try:
        account = repo.resolve_account_for_user(user_id=user_id, email=email)
        if not account:
            raise HTTPException(status_code=404, detail=f"No connected Gmail account for user_id={user_id}")
        return {
            "connected": True,
            "user_id": user_id,
            "email": account.get("email"),
            "last_sync_at": account.get("last_sync_at"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/oauth/connect")
def oauth_connect(req: ConnectRequest):
    try:
        account = sync_service.connect_account(req.user_id, req.code)
        return {"connected": True, "account": account}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/oauth/callback")
def oauth_callback(code: str, state: str | None = None):
    user_id = ""
    if state and state.startswith("qumail:"):
        user_id = state.split(":", 1)[1]

    if not user_id:
        raise HTTPException(status_code=400, detail="Missing or invalid state. Expected state=qumail:<user_id>")

    try:
        sync_service.connect_account(user_id=user_id, code=code)
        redirect_url = f"{settings.frontend_app_url.rstrip('/')}/inbox?gmail_connected=1"
        return RedirectResponse(url=redirect_url, status_code=302)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sync/user/{user_id}", response_model=SyncResponse)
def sync_user(user_id: str, email: str | None = None):
    try:
        result = sync_service.sync_user(user_id=user_id, user_email=email)
        return SyncResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OSError as exc:
        message = str(exc).lower()
        if getattr(exc, "winerror", None) == 10035 or "winerror 10035" in message or "non-blocking socket" in message:
            raise HTTPException(status_code=503, detail="Temporary network/socket issue while syncing Gmail. Please retry.") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        message = str(exc).lower()
        if "winerror 10035" in message or "non-blocking socket" in message:
            raise HTTPException(status_code=503, detail="Temporary network/socket issue while syncing Gmail. Please retry.") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sync/all")
def sync_all():
    try:
        return sync_service.sync_all()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/mail/send")
def mail_send(req: SendMailRequest):
    try:
        result = sync_service.send_via_gmail(
            user_id=req.user_id,
            user_email=req.user_email,
            to_email=req.to,
            subject=req.subject,
            body_text=req.body,
        )
        return {"sent": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/auth/register")
def auth_register(req: AuthRequest):
    try:
        identifier = (req.username or req.email or "").strip()
        if not identifier:
            raise HTTPException(status_code=400, detail="Username is required.")
        result = repo.register_user(username=identifier, password=req.password)
        if not result.get("user_id"):
            raise HTTPException(status_code=400, detail="Registration failed. Confirm email settings or Supabase auth configuration.")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        status = 409 if "already exists" in message.lower() else 400
        raise HTTPException(status_code=status, detail=message) from exc


@app.post("/auth/login")
def auth_login(req: AuthRequest):
    try:
        identifier = (req.username or req.email or "").strip()
        if not identifier:
            raise HTTPException(status_code=400, detail="Username is required.")
        result = repo.login_user(username=identifier, password=req.password)
        if not result.get("user_id"):
            raise HTTPException(status_code=401, detail="Invalid login response from Supabase.")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        if "register first" in message.lower() or "user not found" in message.lower():
            raise HTTPException(status_code=404, detail=message) from exc
        raise HTTPException(status_code=401, detail=message) from exc


@app.post("/auth/logout")
def auth_logout(req: LogoutRequest):
    try:
        repo.logout_user(req.access_token)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/messages/{user_id}")
def list_messages(user_id: str, folder: str = "INBOX", limit: int = 100, email: str | None = None):
    try:
        messages = sync_service.list_messages(user_id=user_id, folder=folder, limit=limit, user_email=email)
        return {"user_id": user_id, "folder": folder.upper(), "count": len(messages), "messages": messages}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/message/{user_id}/{gmail_message_id}")
def hydrate_message(user_id: str, gmail_message_id: str, email: str | None = None):
    try:
        message = sync_service.hydrate_message(user_id=user_id, gmail_message_id=gmail_message_id, user_email=email)
        return {"user_id": user_id, "message": message}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
