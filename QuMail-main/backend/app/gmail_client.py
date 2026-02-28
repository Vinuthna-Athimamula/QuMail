from __future__ import annotations

import base64
import os
import socket
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import parseaddr
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from .config import settings


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class GmailClient:
    @staticmethod
    def _is_transient_socket_error(exc: Exception) -> bool:
        winerror = getattr(exc, "winerror", None)
        if winerror == 10035:
            return True

        message = str(exc).lower()
        return "winerror 10035" in message or "non-blocking socket" in message

    def _run_with_retry(self, operation, retries: int = 3, delay_seconds: float = 0.2):
        last_error: Exception | None = None
        for attempt in range(retries):
            try:
                return operation()
            except Exception as exc:
                last_error = exc
                if not self._is_transient_socket_error(exc) or attempt == retries - 1:
                    raise
                time.sleep(delay_seconds * (attempt + 1))

        if last_error:
            raise last_error

    def _execute_with_retry(self, request):
        return self._run_with_retry(lambda: request.execute())

    @staticmethod
    def _decode_body_data(data: str | None) -> str:
        if not data:
            return ""
        try:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        except Exception:
            return ""

    @staticmethod
    def _extract_plain_text(payload: dict[str, Any] | None) -> str:
        if not payload:
            return ""

        body = payload.get("body") or {}
        data = body.get("data")
        mime_type = (payload.get("mimeType") or "").lower()
        if data and mime_type.startswith("text/plain"):
            return GmailClient._decode_body_data(data)

        text_parts: list[str] = []
        for part in payload.get("parts", []) or []:
            part_text = GmailClient._extract_plain_text(part)
            if part_text:
                text_parts.append(part_text)

        return "\n".join(text_parts).strip()

    @staticmethod
    def _extract_html(payload: dict[str, Any] | None) -> str:
        if not payload:
            return ""

        body = payload.get("body") or {}
        data = body.get("data")
        mime_type = (payload.get("mimeType") or "").lower()
        if data and mime_type.startswith("text/html"):
            return GmailClient._decode_body_data(data)

        for part in payload.get("parts", []) or []:
            html = GmailClient._extract_html(part)
            if html:
                return html

        return ""

    def create_auth_url(self, state: str) -> str:
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uris": [settings.google_redirect_uri],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=settings.scopes,
            redirect_uri=settings.google_redirect_uri,
        )
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )
        return auth_url

    def exchange_code(self, code: str) -> dict[str, Any]:
        os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

        if settings.google_client_secret.endswith(".apps.googleusercontent.com"):
            raise RuntimeError(
                "Invalid GOOGLE_CLIENT_SECRET configuration. It looks like a client ID was provided instead of the OAuth client secret."
            )

        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uris": [settings.google_redirect_uri],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=settings.scopes,
            redirect_uri=settings.google_redirect_uri,
        )
        try:
            flow.fetch_token(code=code)
        except Exception as exc:
            raise RuntimeError(
                "Google OAuth token exchange failed. Verify GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and authorized redirect URI in Google Cloud Console. "
                f"Original error: {exc}"
            ) from exc
        creds = flow.credentials

        gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)
        profile = self._execute_with_retry(gmail.users().getProfile(userId="me"))

        return {
            "email": profile.get("emailAddress"),
            "history_id": str(profile.get("historyId")) if profile.get("historyId") else None,
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
            "token_expiry": creds.expiry.isoformat() if creds.expiry else None,
            "connected_at": _now_iso(),
        }

    def _creds_from_account(self, account: dict[str, Any]) -> Credentials:
        creds = Credentials(
            token=account.get("access_token"),
            refresh_token=account.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            scopes=settings.scopes,
        )
        return creds

    def ensure_fresh_access_token(self, account: dict[str, Any]) -> tuple[Credentials, bool]:
        creds = self._creds_from_account(account)
        refreshed = False
        if not creds.valid and creds.refresh_token:
            self._run_with_retry(lambda: creds.refresh(Request()))
            refreshed = True
        return creds, refreshed

    def list_message_ids(self, creds: Credentials, history_id: str | None) -> tuple[list[str], str | None]:
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)

        if history_id:
            history_req = (
                service.users()
                .history()
                .list(userId="me", startHistoryId=history_id, historyTypes=["messageAdded"], maxResults=100)
            )
            history = self._execute_with_retry(history_req)
            ids: set[str] = set()
            for h in history.get("history", []):
                for add in h.get("messagesAdded", []):
                    msg = add.get("message", {})
                    if msg.get("id"):
                        ids.add(msg["id"])

            recent_req = (
                service.users()
                .messages()
                .list(userId="me", q=settings.gmail_query, maxResults=25)
            )
            recent = self._execute_with_retry(recent_req)
            for msg in recent.get("messages", []) or []:
                msg_id = msg.get("id")
                if msg_id:
                    ids.add(msg_id)

            return list(ids), str(history.get("historyId")) if history.get("historyId") else history_id

        msg_list_req = (
            service.users()
            .messages()
            .list(userId="me", q=settings.gmail_query, maxResults=50)
        )
        msg_list = self._execute_with_retry(msg_list_req)
        ids = [m["id"] for m in msg_list.get("messages", []) if m.get("id")]
        profile = self._execute_with_retry(service.users().getProfile(userId="me"))
        latest = str(profile.get("historyId")) if profile.get("historyId") else None
        return ids, latest

    def get_message_metadata(self, creds: Credentials, message_id: str) -> dict[str, Any]:
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        msg_req = (
            service.users()
            .messages()
            .get(userId="me", id=message_id, format="full", metadataHeaders=["Subject", "From", "Date"])
        )
        msg = self._execute_with_retry(msg_req)

        headers = {h.get("name", "").lower(): h.get("value", "") for h in msg.get("payload", {}).get("headers", [])}
        from_header = headers.get("from", "")
        _, from_email = parseaddr(from_header)

        internal_ms = int(msg.get("internalDate", "0"))
        internal_iso = datetime.fromtimestamp(internal_ms / 1000, tz=timezone.utc).isoformat() if internal_ms else None
        body_text = self._extract_plain_text(msg.get("payload"))
        body_html = self._extract_html(msg.get("payload"))

        return {
            "gmail_message_id": msg.get("id"),
            "thread_id": msg.get("threadId"),
            "subject": headers.get("subject", ""),
            "from_email": from_email,
            "from_raw": from_header,
            "snippet": msg.get("snippet", ""),
            "labels": msg.get("labelIds", []),
            "is_unread": "UNREAD" in msg.get("labelIds", []),
            "internal_ts": internal_iso,
            "payload": {
                "body_text": body_text,
                "body_html": body_html,
            },
        }

    def send_message(
        self,
        creds: Credentials,
        from_email: str,
        to_email: str,
        subject: str,
        body_text: str,
    ) -> dict[str, Any]:
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)

        mime = EmailMessage()
        mime["To"] = to_email
        mime["From"] = from_email
        mime["Subject"] = subject
        mime.set_content(body_text)

        raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("utf-8")
        sent = self._execute_with_retry(service.users().messages().send(userId="me", body={"raw": raw}))

        return {
            "gmail_message_id": sent.get("id"),
            "thread_id": sent.get("threadId"),
        }
