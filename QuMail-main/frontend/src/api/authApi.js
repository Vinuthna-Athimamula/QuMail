const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

function getError(payload, fallback) {
  return payload?.detail || payload?.error || fallback;
}

async function request(path, body, fallbackError) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(getError(payload, fallbackError));
  }
  return payload;
}

export function loginApi(username, password) {
  return request('/auth/login', { username, password }, 'Authentication failed.');
}

export function signupApi(username, password) {
  return request('/auth/register', { username, password }, 'Registration failed.');
}

export function logoutApi(accessToken) {
  return request('/auth/logout', { access_token: accessToken }, 'Logout failed.');
}
