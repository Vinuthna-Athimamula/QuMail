import {
  getQkdPairSessionApi,
  getQkdSessionStatusApi,
  initiateQkdSessionApi,
  listActiveQkdApi,
  pingQkdActivityApi,
  readQkdChunkApi,
  reserveQkdChunkApi,
  refillQkdSessionApi,
  searchQkdPeersApi,
} from '../api/qkdApi';

export async function pingQkdActivityService(user) {
  return pingQkdActivityApi(user);
}

export async function listActiveQkdService(user) {
  return listActiveQkdApi(user.id);
}

export async function initiateQkdSessionService(user, peerUserId, targetMb = 100) {
  return initiateQkdSessionApi({
    user_id: user.id,
    peer_user_id: peerUserId,
    target_mb: targetMb,
  });
}

export async function getQkdSessionStatusService(sessionId) {
  return getQkdSessionStatusApi(sessionId);
}

export async function getQkdPairSessionService(user, peerUserId) {
  return getQkdPairSessionApi(user.id, peerUserId);
}

export async function refillQkdSessionService(user, peerUserId, targetMb = 100) {
  return refillQkdSessionApi({
    user_id: user.id,
    peer_user_id: peerUserId,
    target_mb: targetMb,
  });
}

export async function searchQkdPeersService(user, search = '', activeOnly = true) {
  return searchQkdPeersApi(user.id, search, activeOnly);
}

export async function reserveQkdChunkService(user, sessionId, chunkBytes = 32) {
  return reserveQkdChunkApi(sessionId, {
    user_id: user.id,
    chunk_bytes: chunkBytes,
  });
}

export async function readQkdChunkService(user, sessionId, offset, chunkBytes) {
  return readQkdChunkApi(sessionId, {
    user_id: user.id,
    offset,
    chunk_bytes: chunkBytes,
  });
}
