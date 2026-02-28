import { useEffect, useState } from 'react';
import WorkspaceShell from './common/WorkspaceShell';
import { connectGmailService, loadAccountService } from '../services/mailService';

export default function SettingsPage({ user, onLogout }) {
  const [gmailAddress, setGmailAddress] = useState('Not connected');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const loadAccount = async () => {
    try {
      setError('');
      const payload = await loadAccountService(user);
      setGmailAddress(payload?.email || 'Not connected');
    } catch (err) {
      setGmailAddress('Not connected');
      setError(err instanceof Error ? err.message : 'Failed to load account.');
    }
  };

  useEffect(() => {
    loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const connectGmail = async () => {
    setConnecting(true);
    setError('');
    try {
      const payload = await connectGmailService(user);
      if (!payload?.auth_url) {
        throw new Error('Failed to create Gmail OAuth URL.');
      }
      window.location.href = payload.auth_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Gmail OAuth flow.');
      setConnecting(false);
    }
  };

  const leftContent = (
    <>
      {error && <div className="inline-error">{error}</div>}
      <div className="settings-box">
        <h3>Connected Gmail</h3>
        <p>{gmailAddress}</p>
        <div className="settings-actions">
          <button className="mini-btn" onClick={connectGmail} disabled={connecting}>{connecting ? 'Connecting...' : 'Connect Gmail'}</button>
          <button className="mini-btn" onClick={loadAccount}>Refresh Account</button>
        </div>
      </div>
    </>
  );

  const rightContent = (
    <div className="settings-box">
      <h3>Account Settings</h3>
      <p>Manage linked Gmail account and security preferences here.</p>
    </div>
  );

  return (
    <WorkspaceShell
      user={user}
      onLogout={onLogout}
      title="Settings"
      leftContent={leftContent}
      rightContent={rightContent}
    />
  );
}
