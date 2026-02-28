import { useEffect, useState } from 'react';
import { Activity, Zap, AlertTriangle } from 'lucide-react';
import WorkspaceShell from './common/WorkspaceShell';
import {
  getQkdPairSessionService,
  initiateQkdSessionService,
  refillQkdSessionService,
  searchQkdPeersService,
} from '../services/qkdService';

function mb(value) {
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function KeyDashboardPanel({ user }) {
  const [peers, setPeers] = useState([]);
  const [peerSearch, setPeerSearch] = useState('');
  const [peerUserId, setPeerUserId] = useState('');
  const [qkdError, setQkdError] = useState('');
  const [qkdInfo, setQkdInfo] = useState('');
  const [session, setSession] = useState(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [loadingPeers, setLoadingPeers] = useState(false);

  const loadPeers = async (searchText = peerSearch) => {
    setLoadingPeers(true);
    try {
      const payload = await searchQkdPeersService(user, searchText, true);
      const next = payload?.peers || [];
      setPeers(next);
      setQkdError('');

      if (peerUserId && !next.some((item) => item.user_id === peerUserId)) {
        setPeerUserId('');
        setSession(null);
      }
    } catch (error) {
      setQkdError(error instanceof Error ? error.message : 'Could not load active users from Supabase.');
      setPeers([]);
    } finally {
      setLoadingPeers(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        if (!cancelled) {
          await loadPeers(peerSearch);
        }

        if (!cancelled && peerUserId) {
          const pair = await getQkdPairSessionService(user, peerUserId);
          setSession(pair?.session || null);
        }
      } catch (error) {
        if (!cancelled) {
          setQkdError(error instanceof Error ? error.message : 'QKD presence service is unavailable.');
        }
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, peerUserId]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadPeers(peerSearch);
    }, 250);
    return () => clearTimeout(handle);
  }, [peerSearch]);

  const handleCreateQkd = async () => {
    if (!peerUserId.trim()) {
      setQkdError('Select an active peer email.');
      return;
    }

    setQkdError('');
    setQkdInfo('');
    setCreatingSession(true);
    try {
      const created = await initiateQkdSessionService(user, peerUserId.trim(), 100);
      setSession(created);
      const selected = peers.find((item) => item.user_id === peerUserId);
      setQkdInfo(`QKD session created with ${selected?.label || peerUserId}. Buffer: ${mb(created.total_bytes)}.`);
    } catch (error) {
      setQkdError(error instanceof Error ? error.message : 'Failed to initiate QKD session. Make sure both users are active now.');
    } finally {
      setCreatingSession(false);
    }
  };

  const handleEstimateAndRefill = async () => {
    if (!peerUserId.trim()) {
      setQkdError('Select an active peer email.');
      return;
    }

    setQkdError('');
    setQkdInfo('');
    setEstimating(true);
    try {
      const result = await refillQkdSessionService(user, peerUserId.trim(), 100);
      setSession(result.session || null);
      setQkdInfo(
        `Estimated from mails: ${mb(result.estimated_mail_bytes)}. Target: ${result.estimated_target_mb} MB. Added: ${result.added_mb} MB.`,
      );
    } catch (error) {
      setQkdError(error instanceof Error ? error.message : 'Failed to refill QKD buffer. Make sure both users are active now.');
    } finally {
      setEstimating(false);
    }
  };

  return (
    <div className="keys-root">
      <div className="section-head">
        <div className="section-head-icon">
          <Activity size={20} className="tone-quantum" />
        </div>
        <div>
          <h2 className="section-title">QKD Key Manager</h2>
          <p className="section-subtitle">Quantum QRNG-backed pool with secure local fallback</p>
        </div>
      </div>

      <div className="levels-card">
        <h3 className="levels-title">Online Emails & Pairwise QKD</h3>
        <p className="levels-subtitle">Both accounts must be active now. Search by email and select from active users to generate pairwise key material.</p>

        <div className="qkd-form">
          <div className="qkd-meta-row">
            <span className="level-name tone-qaes">Active users: {peers.length}</span>
            {loadingPeers ? <span className="level-note">Refreshing active users…</span> : <span className="level-note">Email search filters active user list</span>}
          </div>

          <div className="qkd-input-row">
            <input
              className="decrypt-input qkd-input"
              placeholder="Search peer by email"
              value={peerSearch}
              onChange={(event) => setPeerSearch(event.target.value)}
            />
            <select
              className="decrypt-input qkd-input"
              value={peerUserId}
              onChange={(event) => {
                setPeerUserId(event.target.value);
                setSession(null);
              }}
            >
              <option value="">Select peer</option>
              {peers.map((item) => (
                <option key={item.user_id} value={item.user_id}>{item.email}{item.online ? ' (online)' : ' (offline)'}</option>
              ))}
            </select>
          </div>

          <div className="qkd-actions-row">
            <button className="mini-btn" onClick={handleCreateQkd} disabled={creatingSession || !peerUserId}>
              {creatingSession ? 'Generating…' : 'Connect + Generate QKD'}
            </button>
            <button className="mini-btn" onClick={handleEstimateAndRefill} disabled={estimating || !peerUserId}>
              {estimating ? 'Refilling…' : 'Estimate + Refill'}
            </button>
          </div>

          {qkdError && (
            <div className="notice-box danger">
              <AlertTriangle size={14} />
              <span>{qkdError}</span>
            </div>
          )}
          {qkdInfo && (
            <div className="notice-box otp">
              <Zap size={14} />
              <span>{qkdInfo}</span>
            </div>
          )}

          {session ? (
            <div className="qkd-session-box">
              <div className="qkd-session-row">
                <span className="level-name tone-quantum">Session ID</span>
                <span className="level-source mono">{session.session_id}</span>
              </div>
              <div className="qkd-session-row">
                <span className="level-name tone-otp">Available</span>
                <span className="level-source mono">{mb(session.available_bytes)}</span>
              </div>
              <div className="level-note">Consumed: {mb(session.consumed_bytes)}</div>
            </div>
          ) : (
            <div className="notice-box aes">
              <AlertTriangle size={14} />
              <span>Select an active peer email and generate pairwise QKD.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function KeysPage({ user, onLogout }) {
  const leftContent = null;

  const rightContent = <div className="keymanager-wrap"><KeyDashboardPanel user={user} /></div>;

  return (
    <WorkspaceShell
      user={user}
      onLogout={onLogout}
      title="Key Manager"
      leftContent={leftContent}
      rightContent={rightContent}
    />
  );
}
