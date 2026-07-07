import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLogin } from '../api/hooks';

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const from = (location.state as { from?: string } | null)?.from ?? '/trips';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    login.mutate(
      { email, password },
      {
        onSuccess: () => navigate(from, { replace: true }),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="brand">织程 <span className="brand-en">TripWeaver</span></h1>
        <p className="auth-sub">AI 替你刷攻略、排行程</p>
        <form onSubmit={submit} className="form">
          <label>
            邮箱
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            密码
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={login.isPending}>
            {login.isPending ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="auth-switch">
          还没有账号？<Link to="/register">用邀请码注册</Link>
        </p>
      </div>
    </div>
  );
}
