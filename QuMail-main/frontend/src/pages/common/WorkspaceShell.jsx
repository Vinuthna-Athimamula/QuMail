import { useEffect, useState } from 'react';
import {
  CirclePlus,
  Inbox as InboxIcon,
  LogOut,
  Send,
  Shield,
  ShieldCheck,
  UserRound,
  KeyRound,
  FilePenLine,
  Settings,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { connectGmailService, getCachedGmailAccount, loadAccountService } from '../../services/mailService';
import { pingQkdActivityService } from '../../services/qkdService';

export default function WorkspaceShell({
  user,
  onLogout,
  title,
  onRefresh,
  leftContent,
  rightContent,
  badges = {},
}) {
  const navigate = useNavigate();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [gmailAddress, setGmailAddress] = useState('');
  const [connectingGmail, setConnectingGmail] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedGmailAccount(user.id);
    if (cached?.email) {
      setGmailAddress(cached.email);
    }
    loadAccountService(user)
      .then((payload) => {
        if (!cancelled) {
          setGmailAddress(payload?.email || '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGmailAddress('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      try {
        await pingQkdActivityService(user);
      } catch {
        if (!cancelled) {
          // no-op: QKD activity ping is best-effort
        }
      }
    };

    void ping();
    const timer = setInterval(() => {
      void ping();
    }, 20000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  const connectGmail = async () => {
    setConnectingGmail(true);
    try {
      const payload = await connectGmailService(user);
      if (!payload?.auth_url) {
        throw new Error('Missing OAuth URL');
      }
      window.location.href = payload.auth_url;
    } catch {
      setConnectingGmail(false);
    }
  };

  const menuItems = [
    { to: '/inbox', label: 'Inbox', icon: <InboxIcon size={18} />, badge: badges.inbox || 0 },
    { to: '/sent', label: 'Sent', icon: <Send size={18} />, badge: badges.sent || 0 },
    { to: '/drafts', label: 'Drafts', icon: <FilePenLine size={18} />, badge: badges.drafts || 0 },
  ];

  return (
    <div className="mail-app">
      <header className="topbar">
        <div className="brand-left">
          <div className="brand-mini"><Shield size={16} /></div>
          <strong>QuMail</strong>
          <div className="search-wrap">
            <input placeholder="Search messages..." disabled />
          </div>
        </div>

        <div className="topbar-right">
          <NavLink className="compose-btn" to="/compose">
            <CirclePlus size={16} /> Compose
          </NavLink>
          {gmailAddress ? (
            <a
              className="gmail-pill gmail-pill-link"
              href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(gmailAddress)}`}
              target="_blank"
              rel="noreferrer"
              title={`Open Gmail (${gmailAddress})`}
            >
              {gmailAddress}
            </a>
          ) : (
            <button className="gmail-connect-btn" onClick={connectGmail} disabled={connectingGmail}>
              {connectingGmail ? 'Connecting...' : 'Connect Gmail'}
            </button>
          )}
          <div className="top-avatar">{(user.email || 'U')[0].toUpperCase()}</div>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-nav">
          <div className="nav-section">MAILBOXES</div>
          {menuItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.badge > 0 && <span className="badge">{item.badge}</span>}
            </NavLink>
          ))}

          <div className="nav-section">SECURITY</div>
          <NavLink to="/security-logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span><ShieldCheck size={18} /></span>
            <span>Security Logs</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span><Settings size={18} /></span>
            <span>Settings</span>
          </NavLink>
        </aside>

        <section className="mail-list-panel">
          <div className="panel-head">
            <h2>{title}</h2>
            {onRefresh && <button className="mini-btn" onClick={onRefresh}>Refresh</button>}
          </div>
          {leftContent}
        </section>

        <section className="mail-detail-panel">
          {rightContent}
        </section>
      </main>

      <div className="profile-fab-wrap">
        <button className="profile-fab" onClick={() => setProfileMenuOpen((prev) => !prev)}>
          <UserRound size={18} />
        </button>
        {profileMenuOpen && (
          <div className="profile-menu">
            <button onClick={() => { navigate('/keys'); setProfileMenuOpen(false); }}>
              <KeyRound size={16} /> Key Manager
            </button>
            <button onClick={() => { setProfileMenuOpen(false); onLogout(); }}>
              <LogOut size={16} /> Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
