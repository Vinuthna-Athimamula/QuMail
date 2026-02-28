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

export async function heartbeatQkdApi(user) {
  const response = await fetch(`${BACKEND_URL}/qkd/presence/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: user.id,
      user_email: user.email || null,
      username: user.username || null,
    }),
  });
  return parse(response, 'Failed to update active presence.');
}

export async function pingQkdActivityApi(user) {
  const response = await fetch(`${BACKEND_URL}/qkd/activity/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: user.id,
      user_email: user.email || null,
      username: user.username || null,
    }),
  });
  return parse(response, 'Failed to update QKD activity.');
}

export async function listActiveQkdApi(excludeUserId) {
  const params = new URLSearchParams();
  if (excludeUserId) {
    params.set('exclude_user_id', excludeUserId);
  }
  const query = params.toString();
  const response = await fetch(`${BACKEND_URL}/qkd/presence/active${query ? `?${query}` : ''}`);
  return parse(response, 'Failed to fetch active users.');
}

export async function searchQkdPeersApi(userId, search = '', activeOnly = true) {
  const params = new URLSearchParams({
    user_id: userId,
    active_only: String(activeOnly),
  });
  if (search && search.trim()) {
    params.set('q', search.trim());
  }
  const response = await fetch(`${BACKEND_URL}/qkd/peers?${params.toString()}`);
  return parse(response, 'Failed to search QKD peers.');
}

export async function initiateQkdSessionApi(payload) {
  const response = await fetch(`${BACKEND_URL}/qkd/session/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(response, 'Failed to initiate QKD session.');
}

export async function getQkdSessionStatusApi(sessionId) {
  const response = await fetch(`${BACKEND_URL}/qkd/session/${encodeURIComponent(sessionId)}`);
  return parse(response, 'Failed to fetch QKD session status.');
}

export async function getQkdPairSessionApi(userId, peerUserId) {
  const params = new URLSearchParams({ user_id: userId, peer_user_id: peerUserId });
  const response = await fetch(`${BACKEND_URL}/qkd/session/pair?${params.toString()}`);
  return parse(response, 'Failed to fetch pair session status.');
}

export async function refillQkdSessionApi(payload) {
  const response = await fetch(`${BACKEND_URL}/qkd/session/refill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(response, 'Failed to refill QKD session.');
}

export async function reserveQkdChunkApi(sessionId, payload) {
  const response = await fetch(`${BACKEND_URL}/qkd/session/${encodeURIComponent(sessionId)}/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(response, 'Failed to reserve QKD key chunk.');
}

export async function readQkdChunkApi(sessionId, payload) {
  const response = await fetch(`${BACKEND_URL}/qkd/session/${encodeURIComponent(sessionId)}/chunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parse(response, 'Failed to read QKD key chunk.');
}
