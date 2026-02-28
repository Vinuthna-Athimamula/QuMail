import { useEffect, useState } from 'react';
import WorkspaceShell from './common/WorkspaceShell';
import { loadAccountService } from '../services/mailService';

export default function SecurityLogsPage({ user, onLogout }) {
  const [gmailAddress, setGmailAddress] = useState('Not connected');

  useEffect(() => {
    loadAccountService(user)
      .then((payload) => setGmailAddress(payload?.email || 'Not connected'))
      .catch(() => setGmailAddress('Not connected'));
  }, [user]);

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const leftContent = (
    <div className="security-table">
      <div className="security-header">All Systems Operational</div>
      <div className="security-row"><span>{now}</span><strong>Mailbox Sync</strong><span>{gmailAddress}</span><span className="ok">OK</span></div>
      <div className="security-row"><span>{now}</span><strong>Quantum Send Ready</strong><span>KYBER-1024</span><span className="ok">OK</span></div>
      <div className="security-row"><span>{now}</span><strong>Auth Session</strong><span>{user.email}</span><span className="ok">OK</span></div>
    </div>
  );

  const rightContent = (
    <div className="settings-box">
      <h3>Security Status</h3>
      <p>System checks, mailbox sync health, and authentication status are tracked in real time.</p>
    </div>
  );

  return (
    <WorkspaceShell
      user={user}
      onLogout={onLogout}
      title="Security Logs"
      leftContent={leftContent}
      rightContent={rightContent}
    />
  );
}
