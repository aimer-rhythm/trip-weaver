import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRegister } from '../api/hooks';

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setError('');
    register.mutate(
      { email, password, inviteCode },
      {
        onSuccess: () => navigate('/trips', { replace: true }),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="brand">织程 <span className="brand-en">TripWeaver</span></h1>
        <p className="auth-sub">凭邀请码注册，注册即可开始规划</p>
        <form onSubmit={submit} className="form">
          <label>
            邮箱
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            密码（至少 8 位）
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label>
            确认密码
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
          <label>
            邀请码
            <input required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="向站长索取" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={register.isPending}>
            {register.isPending ? '注册中…' : '注册并登录'}
          </button>
        </form>
        <p className="auth-switch">
          已有账号？<Link to="/login">直接登录</Link>
        </p>
      </div>
    </div>
  );
}
