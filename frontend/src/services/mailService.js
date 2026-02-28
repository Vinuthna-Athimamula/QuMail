import {
  getAccountApi,
  hydrateMessageApi,
  getMessagesApi,
  getOauthUrlApi,
  sendMailApi,
  syncUserApi,
} from '../api/mailApi';

const GMAIL_CACHE_KEY = 'qumail-gmail-connected-cache';
const GMAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadGmailCache() {
  try {
    const raw = localStorage.getItem(GMAIL_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveGmailCache(cache) {
  localStorage.setItem(GMAIL_CACHE_KEY, JSON.stringify(cache));
}

function setCachedGmailAccount(userId, email) {
  if (!userId || !email) {
    return;
  }
  const cache = loadGmailCache();
  cache[userId] = {
    email,
    expiresAt: Date.now() + GMAIL_CACHE_TTL_MS,
  };
  saveGmailCache(cache);
}

export function getCachedGmailAccount(userId) {
  const cache = loadGmailCache();
  const entry = cache[userId];
  if (!entry) {
    return null;
  }
  if (!entry.expiresAt || entry.expiresAt < Date.now()) {
    delete cache[userId];
    saveGmailCache(cache);
    return null;
  }
  return { email: entry.email };
}

export async function loadAccountService(user) {
  try {
    const payload = await getAccountApi(user.id, user.email);
    if (payload?.email) {
      setCachedGmailAccount(user.id, payload.email);
    }
    return payload;
  } catch (error) {
    const cached = getCachedGmailAccount(user.id);
    if (cached?.email) {
      return {
        connected: true,
        user_id: user.id,
        email: cached.email,
      };
    }
    throw error;
  }
}

export async function syncAndGetMessagesService(user, folder) {
  await syncUserApi(user.id, user.email);
  return getMessagesApi(user.id, folder, user.email, 100);
}

export async function connectGmailService(user) {
  return getOauthUrlApi(user.id);
}

export async function sendMailService(user, payload) {
  return sendMailApi({
    user_id: user.id,
    user_email: user.email,
    ...payload,
  });
}

export async function hydrateMessageService(user, gmailMessageId) {
  return hydrateMessageApi(user.id, gmailMessageId, user.email);
}
