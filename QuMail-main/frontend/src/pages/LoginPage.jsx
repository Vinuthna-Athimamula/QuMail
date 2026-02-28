import { useState } from 'react';
import { Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LoginPage({ onSubmit, loading, error }) {
  const [form, setForm] = useState({ username: '', password: '' });

  const submit = () => {
    onSubmit('login', form, () => setForm({ username: '', password: '' }));
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand-wrap">
          <div className="brand-box"><Shield size={18} /></div>
          <h1>QuMail</h1>
          <p>QUANTUM-SECURED COMMUNICATION</p>
        </div>

        <div className="auth-tabs">
          <Link to="/login" className="active">Login</Link>
          <Link to="/signup">Register</Link>
        </div>

        <label>Username</label>
        <input
          type="text"
          value={form.username}
          placeholder="alice"
          onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
        />

        <label>Password</label>
        <input
          type="password"
          value={form.password}
          placeholder="••••••••"
          onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
        />

        {error && <div className="auth-error">{error}</div>}

        <button className="auth-submit" onClick={submit} disabled={loading}>
          {loading ? 'Please wait...' : 'Sign In Securely'}
        </button>
      </div>
    </div>
  );
}
