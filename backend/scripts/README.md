# QuMail Backend (Python + Gmail + Supabase)

This backend provides:
- Gmail OAuth connect flow
- Gmail send API for outbound mail through connected Gmail account
- Near real-time sync loop (polling Gmail history API)
- Message storage in Supabase
- FastAPI endpoints for connect/sync

## 1) Install

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2) Configure

Copy `.env.example` to `.env` and fill values:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_OAUTH_SCOPES` (must include `gmail.send`)
- `CORS_ORIGINS` (frontend URLs)
- `QKD_PRESENCE_TTL_SECONDS` (default `60`)
- `QKD_SESSION_TTL_SECONDS` (default `3600`)
- `QKD_MAX_BUFFER_MB` (default `128`)

## 3) Create DB tables in Supabase

Run SQL from `scripts/init_schema.sql` in Supabase SQL editor.

## 4) Start API

```bash
uvicorn app.main:app --reload --port 8000
```

## 5) OAuth + sync flow

1. Get auth URL:
   - `GET /oauth/url?user_id=<your-app-user-id>`
2. Open `auth_url` in browser and approve Gmail access.
3. Google redirects to your redirect URI with `code`.
4. Connect account:
   - `POST /oauth/connect` with JSON:

```json
{
  "user_id": "user-123",
  "code": "google-oauth-code"
}
```

5. Trigger sync:
   - `POST /sync/user/user-123`

Background sync runs automatically every `SYNC_INTERVAL_SECONDS`.

## Endpoints

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /oauth/url?user_id=...`
- `GET /account/{user_id}`
- `POST /oauth/connect`
- `POST /sync/user/{user_id}`
- `POST /sync/all`
- `GET /messages/{user_id}?folder=INBOX&limit=100`
- `POST /mail/send`
- `POST /qkd/presence/heartbeat`
- `GET /qkd/presence/active?exclude_user_id=...`
- `POST /qkd/session/initiate`
- `GET /qkd/session/{session_id}`
- `POST /qkd/session/{session_id}/consume`

### QKD presence and 100MB pre-generation

To create a real working pairwise QKD buffer in QuMail:

1. Each user sends heartbeat while app is open:

```json
POST /qkd/presence/heartbeat
{
   "user_id": "user-a"
}
```

2. List active peers:

`GET /qkd/presence/active?exclude_user_id=user-a`

3. Initiate a pair session with a pre-generated 100MB key pool:

```json
POST /qkd/session/initiate
{
   "user_id": "user-a",
   "peer_user_id": "user-b",
   "target_mb": 100
}
```

4. Track available/consumed bytes:

`GET /qkd/session/{session_id}`

5. Consume key chunks for encryption operations:

```json
POST /qkd/session/{session_id}/consume
{
   "user_id": "user-a",
   "chunk_bytes": 4096
}
```

The backend validates both users are active before session creation and keeps a TTL-bound shared buffer per user pair.

### Send mail through Gmail

`POST /mail/send`

```json
{
   "user_id": "user-123",
   "to": "recipient@gmail.com",
   "subject": "Hello from QuMail",
   "body": "Encrypted payload or plain text"
}
```

The sender is the Gmail account connected for that `user_id`.

## Frontend wiring

Set in frontend `.env`:

```dotenv
VITE_BACKEND_URL=http://127.0.0.1:8000
```
The app uses the authenticated Supabase `user_id` for OAuth connect, mailbox sync, message fetch, and sending through Gmail.

## Notes

- This uses Gmail History API polling for near real-time updates.
- Tokens are stored in DB as plain text in this MVP; use encryption/KMS for production.
- For true push notifications, next step is Gmail `watch` + Google Pub/Sub webhook handling.
