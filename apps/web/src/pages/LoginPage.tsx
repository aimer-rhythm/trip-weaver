import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthConfig, useLogin } from '../api/hooks';

// GitHub OAuth 回调失败经 /login?error=<code> 回传
const OAUTH_ERRORS: Record<string, string> = {
  github_denied: 'GitHub 授权已取消',
  github_state: '登录状态校验失败，请重试',
  github_failed: 'GitHub 登录失败，请稍后重试',
  no_verified_email: 'GitHub 账号缺少已验证的邮箱，无法登录',
  signup_closed: '注册暂未开放，无法通过 GitHub 创建新账号',
};

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: config } = useAuthConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const oauthError = searchParams.get('error');
  const [error, setError] = useState(oauthError ? (OAUTH_ERRORS[oauthError] ?? '登录失败，请重试') : '');

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
        {config?.githubEnabled && (
          <>
            <div className="auth-divider">或</div>
            <a className="btn btn-ghost btn-block" href="/api/auth/github">使用 GitHub 登录</a>
          </>
        )}
        <p className="auth-switch">
          还没有账号？<Link to="/register">{config?.registrationMode === 'invite' ? '用邀请码注册' : '注册'}</Link>
        </p>
      </div>
    </div>
  );
}
