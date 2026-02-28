from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .gmail_client import GmailClient
from .supabase_client import SupabaseRepository


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class SyncService:
    def __init__(self, repo: SupabaseRepository, gmail: GmailClient) -> None:
        self.repo = repo
        self.gmail = gmail

    def connect_account(self, user_id: str, code: str) -> dict[str, Any]:
        token_data = self.gmail.exchange_code(code)
        existing = self.repo.get_account_by_email(token_data["email"])

        payload = {
            "user_id": user_id,
            "email": token_data["email"],
            "access_token": token_data["access_token"],
            "refresh_token": token_data["refresh_token"] or (existing.get("refresh_token") if existing else None),
            "token_expiry": token_data["token_expiry"],
            "history_id": None,
            "updated_at": _now_iso(),
        }
        account = self.repo.upsert_account(payload)
        return account

    def _resolve_account(self, user_id: str, user_email: str | None = None) -> dict[str, Any] | None:
        return self.repo.resolve_account_for_user(user_id=user_id, email=user_email)

    def sync_user(self, user_id: str, user_email: str | None = None) -> dict[str, Any]:
        account = self._resolve_account(user_id=user_id, user_email=user_email)
        if not account:
            raise ValueError(f"No connected Gmail account for user_id={user_id}")
        return self.sync_account(account)

    def list_messages(self, user_id: str, folder: str = "INBOX", limit: int = 100, user_email: str | None = None) -> list[dict[str, Any]]:
        self._resolve_account(user_id=user_id, user_email=user_email)
        return self.repo.list_messages_for_user(user_id=user_id, folder=folder, limit=limit)

    def hydrate_message(self, user_id: str, gmail_message_id: str, user_email: str | None = None) -> dict[str, Any]:
        account = self._resolve_account(user_id=user_id, user_email=user_email)
        if not account:
            raise ValueError(f"No connected Gmail account for user_id={user_id}")

        creds, refreshed = self.gmail.ensure_fresh_access_token(account)
        if refreshed:
            account = self.repo.update_account(
                account["id"],
                {
                    "access_token": creds.token,
                    "token_expiry": creds.expiry.isoformat() if creds.expiry else None,
                    "updated_at": _now_iso(),
                },
            )

        metadata = self.gmail.get_message_metadata(creds, gmail_message_id)
        self.repo.upsert_message(
            {
                "account_id": account["id"],
                **metadata,
                "last_synced_at": _now_iso(),
            }
        )
        return metadata

    def send_via_gmail(self, user_id: str, to_email: str, subject: str, body_text: str, user_email: str | None = None) -> dict[str, Any]:
        account = self._resolve_account(user_id=user_id, user_email=user_email)
        if not account:
            raise ValueError(f"No connected Gmail account for user_id={user_id}")

        creds, refreshed = self.gmail.ensure_fresh_access_token(account)
        if refreshed:
            account = self.repo.update_account(
                account["id"],
                {
                    "access_token": creds.token,
                    "token_expiry": creds.expiry.isoformat() if creds.expiry else None,
                    "updated_at": _now_iso(),
                },
            )

        sent = self.gmail.send_message(
            creds=creds,
            from_email=account["email"],
            to_email=to_email,
            subject=subject,
            body_text=body_text,
        )

        return {
            "email": account["email"],
            "to": to_email,
            "subject": subject,
            **sent,
        }

    def sync_all(self) -> dict[str, Any]:
        accounts = self.repo.list_accounts()
        results = []
        for account in accounts:
            try:
                results.append(self.sync_account(account))
            except Exception as exc:
                results.append({"email": account.get("email"), "synced": 0, "error": str(exc)})
        return {"count": len(accounts), "results": results}

    def sync_account(self, account: dict[str, Any]) -> dict[str, Any]:
        creds, refreshed = self.gmail.ensure_fresh_access_token(account)
        if refreshed:
            account = self.repo.update_account(
                account["id"],
                {
                    "access_token": creds.token,
                    "token_expiry": creds.expiry.isoformat() if creds.expiry else None,
                    "updated_at": _now_iso(),
                },
            )

        old_history = account.get("history_id")
        ids, new_history = self.gmail.list_message_ids(creds, old_history)

        synced = 0
        for message_id in ids:
            metadata = self.gmail.get_message_metadata(creds, message_id)
            self.repo.upsert_message(
                {
                    "account_id": account["id"],
                    **metadata,
                    "last_synced_at": _now_iso(),
                }
            )
            synced += 1

        self.repo.update_account(
            account["id"],
            {
                "history_id": new_history,
                "last_sync_at": _now_iso(),
                "updated_at": _now_iso(),
            },
        )

        return {
            "email": account.get("email"),
            "synced": synced,
            "history_id": new_history,
        }
