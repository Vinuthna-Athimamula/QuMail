const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

function getError(payload, fallback) {
  return payload?.detail || payload?.error || fallback;
}

async function parse(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getError(payload, fallback));
  }
  return payload;
}

export async function getAccountApi(userId, email) {
  const emailQuery = email ? `?email=${encodeURIComponent(email)}` : '';
  const response = await fetch(`${BACKEND_URL}/account/${encodeURIComponent(userId)}${emailQuery}`);
  return parse(response, 'Failed to fetch account status.');
}

export async function syncUserApi(userId, email) {
  const emailQuery = email ? `?email=${encodeURIComponent(email)}` : '';
  const response = await fetch(`${BACKEND_URL}/sync/user/${encodeURIComponent(userId)}${emailQuery}`, { method: 'POST' });
  return parse(response, 'Failed to sync mailbox.');
}

export async function getMessagesApi(userId, folder, email, limit = 100) {
  const params = new URLSearchParams({ folder, limit: String(limit) });
  if (email) {
    params.set('email', email);
  }
  const response = await fetch(`${BACKEND_URL}/messages/${encodeURIComponent(userId)}?${params.toString()}`);
  return parse(response, 'Failed to load mailbox messages.');
}

export async function hydrateMessageApi(userId, gmailMessageId, email) {
  const params = new URLSearchParams();
  if (email) {
    params.set('email', email);
  }
  const query = params.toString();
  const response = await fetch(
    `${BACKEND_URL}/message/${encodeURIComponent(userId)}/${encodeURIComponent(gmailMessageId)}${query ? `?${query}` : ''}`,
  );
  return parse(response, 'Failed to load full message content.');
}

export async function getOauthUrlApi(userId) {
  const response = await fetch(`${BACKEND_URL}/oauth/url?user_id=${encodeURIComponent(userId)}`);
  return parse(response, 'Failed to start Gmail OAuth flow.');
}

export async function sendMailApi(payload) {
  const response = await fetch(`${BACKEND_URL}/mail/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(response, 'Failed to send email.');
}
