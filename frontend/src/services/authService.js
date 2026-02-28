import { loginApi, logoutApi, signupApi } from '../api/authApi';

const AUTH_KEY = 'qumail-auth-user';

export function loadSessionUser() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSessionUser(user) {
  if (!user) {
    localStorage.removeItem(AUTH_KEY);
    return;
  }
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

export async function loginService(username, password) {
  const payload = await loginApi(username, password);
  return {
    id: payload.user_id,
    email: payload.email,
    username: payload.username || username,
    access_token: payload.access_token,
  };
}

export async function signupService(username, password) {
  const payload = await signupApi(username, password);
  return {
    id: payload.user_id,
    email: payload.email,
    username: payload.username || username,
    access_token: payload.access_token,
  };
}

export async function logoutService(user) {
  if (user?.access_token) {
    try {
      await logoutApi(user.access_token);
    } catch {
      // noop
    }
  }
  saveSessionUser(null);
}
