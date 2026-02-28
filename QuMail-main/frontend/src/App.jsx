import { useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import InboxPage from './pages/InboxPage';
import SentPage from './pages/SentPage';
import DraftsPage from './pages/DraftsPage';
import ComposePage from './pages/ComposePage';
import SecurityLogsPage from './pages/SecurityLogsPage';
import SettingsPage from './pages/SettingsPage';
import KeysPage from './pages/KeysPage';
import {
  loadSessionUser,
  loginService,
  logoutService,
  saveSessionUser,
  signupService,
} from './services/authService';

export default function App() {
  const location = useLocation();
  const [user, setUser] = useState(() => loadSessionUser());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const persistUser = (nextUser) => {
    saveSessionUser(nextUser);
    setUser(nextUser);
  };

  const runAuth = async (mode, form, onSuccess) => {
    if (!form.username.trim() || !form.password.trim()) {
      setAuthError('Username and password are required.');
      return;
    }

    setAuthError('');
    setAuthLoading(true);
    try {
      const nextUser = mode === 'signup'
        ? await signupService(form.username.trim(), form.password)
        : await loginService(form.username.trim(), form.password);

      persistUser(nextUser);
      onSuccess?.();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Authentication failed.';
      if (mode === 'login' && /register first|not found|invalid credentials/i.test(rawMessage)) {
        setAuthError('User not found. Please register first from the Signup page.');
      } else {
        setAuthError(rawMessage);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await logoutService(user);
    setUser(null);
  };

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSubmit={runAuth} loading={authLoading} error={authError} />} />
        <Route path="/signup" element={<SignupPage onSubmit={runAuth} loading={authLoading} error={authError} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/') {
    return <Navigate to="/inbox" replace />;
  }

  return (
    <Routes>
      <Route path="/inbox" element={<InboxPage user={user} onLogout={logout} />} />
      <Route path="/sent" element={<SentPage user={user} onLogout={logout} />} />
      <Route path="/drafts" element={<DraftsPage user={user} onLogout={logout} />} />
      <Route path="/compose" element={<ComposePage user={user} onLogout={logout} />} />
      <Route path="/security-logs" element={<SecurityLogsPage user={user} onLogout={logout} />} />
      <Route path="/settings" element={<SettingsPage user={user} onLogout={logout} />} />
      <Route path="/keys" element={<KeysPage user={user} onLogout={logout} />} />
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}
