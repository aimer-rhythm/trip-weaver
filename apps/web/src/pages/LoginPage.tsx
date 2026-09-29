import { Button, buttonClassName } from '../components/ui/Button';
import { Input } from '../components/ui/Field';
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
    <div className={"auth-page [min-height:100vh] flex items-center justify-center [padding:24px_16px]"}>
      <div className={"auth-card w-full [max-width:380px] [background:var(--color-card)] [border:1px_solid_var(--color-border)] [border-radius:14px] [box-shadow:var(--shadow)] [padding:28px_24px] [&_.brand]:[font-size:1.4rem]"}>
        <h1 className={"brand flex items-center [gap:8px] font-bold [font-size:1.1rem] [color:var(--color-ink)]"}>织程 <span className={"brand-en [color:var(--color-brand-en-color-1)] font-semibold"}>TripWeaver</span></h1>
        <p className={"auth-sub [color:var(--color-muted)] [margin:6px_0_20px]"}>AI 替你刷攻略、排行程</p>
        <form onSubmit={submit} className={"form flex flex-col [gap:12px] [&_label]:flex [&_label]:flex-col [&_label]:[gap:5px] [&_label]:[font-size:0.88rem] [&_label]:[color:var(--color-muted)]"}>
          <label>
            邮箱
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            密码
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{error}</p>}
          <Button variant="primary" type="submit" className={"btn-block w-full justify-center"} loading={login.isPending}>
            {login.isPending ? '登录中…' : '登录'}
          </Button>
        </form>
        {config?.githubEnabled && (
          <>
            <div className={"auth-divider flex items-center [gap:10px] [margin:14px_0_10px] [font-size:0.82rem] [color:var(--color-muted)] [&::before]:[content:''] [&::before]:flex-1 [&::before]:[height:1px] [&::before]:[background:var(--color-border)] [&::after]:[content:''] [&::after]:flex-1 [&::after]:[height:1px] [&::after]:[background:var(--color-border)]"}>或</div>
            <a className={`${buttonClassName('secondary')} box-border w-full no-underline`} href="/api/auth/github">使用 GitHub 登录</a>
          </>
        )}
        <p className={"auth-switch [margin:16px_0_0] [font-size:0.88rem] [color:var(--color-muted)]"}>
          还没有账号？<Link to="/register">{config?.registrationMode === 'invite' ? '用邀请码注册' : '注册'}</Link>
        </p>
      </div>
    </div>
  );
}
