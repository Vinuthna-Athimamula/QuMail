from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from postgrest.exceptions import APIError
from supabase import Client, create_client
from gotrue.errors import AuthApiError

from .config import settings


class SupabaseRepository:
    @staticmethod
    def _parse_datetime(value: str | None) -> datetime | None:
        if not value:
            return None
        normalized = value.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

    @staticmethod
    def _normalize_auth_email(username: str) -> str:
        value = username.strip().lower()
        if "@" in value:
            return value
        return f"{value}@qumail.local"

    @staticmethod
    def _username_from_email(email: str | None) -> str:
        if not email:
            return ""
        value = email.strip().lower()
        if value.endswith("@qumail.local"):
            return value[: -len("@qumail.local")]
        return value

    def __init__(self) -> None:
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        self.auth_client: Client = create_client(settings.supabase_url, settings.supabase_auth_key)

    @staticmethod
    def _handle_api_error(exc: APIError) -> RuntimeError:
        message = str(exc)
        if "PGRST205" in message or "Could not find the table" in message:
            return RuntimeError("Supabase schema is not initialized. Run backend/scripts/init_schema.sql in Supabase SQL editor.")
        return RuntimeError(f"Supabase request failed: {message}")

    def get_account_by_user_id(self, user_id: str) -> dict[str, Any] | None:
        try:
            res = (
                self.client.table("gmail_accounts")
                .select("*")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            return res.data[0] if res.data else None
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def resolve_account_for_user(self, user_id: str, email: str | None = None) -> dict[str, Any] | None:
        account = self.get_account_by_user_id(user_id)
        if account:
            return account

        if not email:
            return None

        account = self.get_account_by_email(email)
        if not account:
            return None

        if account.get("user_id") != user_id:
            account = self.update_account(
                account["id"],
                {
                    "user_id": user_id,
                    "updated_at": datetime.now(tz=timezone.utc).isoformat(),
                },
            )
        return account

    def get_account_by_email(self, email: str) -> dict[str, Any] | None:
        try:
            res = (
                self.client.table("gmail_accounts")
                .select("*")
                .eq("email", email)
                .limit(1)
                .execute()
            )
            return res.data[0] if res.data else None
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def list_accounts(self) -> list[dict[str, Any]]:
        try:
            res = self.client.table("gmail_accounts").select("*").execute()
            return res.data or []
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def upsert_account(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            res = (
                self.client.table("gmail_accounts")
                .upsert(payload, on_conflict="email")
                .execute()
            )
            return res.data[0]
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def update_account(self, account_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            res = (
                self.client.table("gmail_accounts")
                .update(payload)
                .eq("id", account_id)
                .execute()
            )
            return res.data[0]
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def upsert_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            res = (
                self.client.table("gmail_messages")
                .upsert(payload, on_conflict="account_id,gmail_message_id")
                .execute()
            )
            return res.data[0]
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def list_messages_for_user(self, user_id: str, folder: str, limit: int = 100) -> list[dict[str, Any]]:
        account = self.get_account_by_user_id(user_id)
        if not account:
            return []

        query = (
            self.client.table("gmail_messages")
            .select("gmail_message_id,thread_id,subject,from_email,from_raw,snippet,labels,is_unread,internal_ts,payload")
            .eq("account_id", account["id"])
            .order("internal_ts", desc=True)
            .limit(limit)
        )

        if folder.upper() == "INBOX":
            query = query.contains("labels", ["INBOX"])
        elif folder.upper() == "SENT":
            query = query.contains("labels", ["SENT"])
        elif folder.upper() in {"DRAFT", "DRAFTS"}:
            query = query.contains("labels", ["DRAFT"])

        try:
            res = query.execute()
            return res.data or []
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def estimate_pair_mail_bytes(self, user_id: str, peer_user_id: str, limit_per_side: int = 300) -> int:
        account_a = self.get_account_by_user_id(user_id)
        account_b = self.get_account_by_user_id(peer_user_id)
        if not account_a or not account_b:
            return 0

        total = 0
        try:
            res_a = (
                self.client.table("gmail_messages")
                .select("subject,snippet,payload")
                .eq("account_id", account_a["id"])
                .eq("from_email", account_b.get("email"))
                .limit(limit_per_side)
                .execute()
            )
            rows_a = res_a.data or []

            res_b = (
                self.client.table("gmail_messages")
                .select("subject,snippet,payload")
                .eq("account_id", account_b["id"])
                .eq("from_email", account_a.get("email"))
                .limit(limit_per_side)
                .execute()
            )
            rows_b = res_b.data or []

            for row in [*rows_a, *rows_b]:
                subject = (row.get("subject") or "")
                snippet = (row.get("snippet") or "")
                payload = row.get("payload") or {}
                body_text = payload.get("body_text") or ""
                body_html = payload.get("body_html") or ""
                total += len(subject.encode("utf-8"))
                total += len(snippet.encode("utf-8"))
                total += len(str(body_text).encode("utf-8"))
                total += len(str(body_html).encode("utf-8"))

            return total
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def search_qkd_peers_by_email(self, user_id: str, query: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
        try:
            query_text = (query or "").strip().lower()
            q = (
                self.client.table("gmail_accounts")
                .select("user_id,email,last_sync_at")
                .neq("user_id", user_id)
                .order("email")
                .limit(limit)
            )
            if query_text:
                q = q.ilike("email", f"%{query_text}%")

            res = q.execute()
            rows = res.data or []

            deduped: dict[str, dict[str, Any]] = {}
            for row in rows:
                peer_id = row.get("user_id")
                email = row.get("email")
                if not peer_id or not email:
                    continue
                deduped[peer_id] = {
                    "user_id": peer_id,
                    "email": email,
                    "last_sync_at": row.get("last_sync_at"),
                    "last_sign_in_at": None,
                    "active_recent": False,
                }

            values = list(deduped.values())
            values.sort(key=lambda item: str(item.get("email") or ""))
            return values[:limit]
        except APIError as exc:
            raise self._handle_api_error(exc) from exc

    def register_user(self, username: str, password: str) -> dict[str, Any]:
        normalized_email = self._normalize_auth_email(username)
        try:
            result = self.auth_client.auth.sign_up({"email": normalized_email, "password": password})
            user = result.user
            session = result.session

            if user and not session:
                try:
                    login_result = self.auth_client.auth.sign_in_with_password(
                        {"email": normalized_email, "password": password}
                    )
                    session = login_result.session
                    user = login_result.user or user
                except AuthApiError:
                    session = None

            return {
                "user_id": user.id if user else None,
                "email": user.email if user else normalized_email,
                "username": self._username_from_email(user.email if user else normalized_email),
                "access_token": session.access_token if session else None,
            }
        except AuthApiError as exc:
            message = str(exc)
            if "already registered" in message.lower() or "already exists" in message.lower():
                raise RuntimeError("User already exists. Please login instead.") from exc
            raise RuntimeError(message) from exc
        except Exception as exc:
            message = str(exc)
            if "already registered" in message.lower() or "already exists" in message.lower() or "duplicate" in message.lower():
                raise RuntimeError("User already exists. Please login instead.") from exc
            raise RuntimeError(message) from exc

    def login_user(self, username: str, password: str) -> dict[str, Any]:
        normalized_email = self._normalize_auth_email(username)
        try:
            result = self.auth_client.auth.sign_in_with_password({"email": normalized_email, "password": password})
            return {
                "user_id": result.user.id if result.user else None,
                "email": result.user.email if result.user else normalized_email,
                "username": self._username_from_email(result.user.email if result.user else normalized_email),
                "access_token": result.session.access_token if result.session else None,
            }
        except AuthApiError as exc:
            message = str(exc)
            normalized = message.lower()
            if "invalid login credentials" in normalized or "email not confirmed" in normalized:
                raise RuntimeError("User not found or invalid credentials. Please register first.") from exc
            raise RuntimeError(message) from exc

    def logout_user(self, access_token: str | None) -> None:
        if not access_token:
            return
        try:
            self.auth_client.auth.set_session(access_token=access_token, refresh_token="")
            self.auth_client.auth.sign_out()
        except Exception:
            return
