import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthConfig, useRegister } from '../api/hooks';

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const { data: config } = useAuthConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');

  const inviteRequired = config?.registrationMode === 'invite';
  const closed = config?.registrationMode === 'closed';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setError('');
    register.mutate(
      { email, password, ...(inviteRequired ? { inviteCode } : {}) },
      {
        onSuccess: () => navigate('/trips', { replace: true }),
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div className={"auth-page [min-height:100vh] flex items-center justify-center [padding:24px_16px]"}>
      <div className={"auth-card w-full [max-width:380px] [background:var(--color-card)] [border:1px_solid_var(--color-border)] [border-radius:14px] [box-shadow:var(--shadow)] [padding:28px_24px] [&_.brand]:[font-size:1.4rem]"}>
        <h1 className={"brand flex items-center [gap:8px] font-bold [font-size:1.1rem] [color:var(--color-ink)]"}>织程 <span className={"brand-en [color:var(--color-brand-en-color-1)] font-semibold"}>TripWeaver</span></h1>
        <p className={"auth-sub [color:var(--color-muted)] [margin:6px_0_20px]"}>{inviteRequired ? '凭邀请码注册，注册即可开始规划' : '注册即可开始规划'}</p>
        {closed ? (
          <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>注册暂未开放，请联系站长</p>
        ) : (
          <>
            <form onSubmit={submit} className={"form flex flex-col [gap:12px] [&_label]:flex [&_label]:flex-col [&_label]:[gap:5px] [&_label]:[font-size:0.88rem] [&_label]:[color:var(--color-muted)] [&_input:not([type='checkbox'])]:[border:1px_solid_var(--color-border)] [&_input:not([type='checkbox'])]:[border-radius:var(--radius)] [&_input:not([type='checkbox'])]:[padding:9px_11px] [&_input:not([type='checkbox'])]:[font-size:0.95rem] [&_input:not([type='checkbox'])]:[color:var(--color-text)] [&_input:not([type='checkbox'])]:[background:var(--color-card)] [&_input:focus]:[outline:2px_solid_var(--color-primary)] [&_input:focus]:[outline-offset:0] [&_input:focus]:[border-color:transparent] [&_select]:[border:1px_solid_var(--color-border)] [&_select]:[border-radius:var(--radius)] [&_select]:[padding:9px_11px] [&_select]:[font-size:0.95rem] [&_select]:[background:var(--color-card)] [&_select]:[color:var(--color-text)]"}>
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
              {inviteRequired && (
                <label>
                  邀请码
                  <input required value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="向站长索取" />
                </label>
              )}
              {error && <p className={"form-error [color:var(--color-danger)] [font-size:0.85rem] m-0"}>{error}</p>}
              <button type="submit" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-primary [background:var(--color-primary)] [color:var(--color-btn-primary-color-3)] [&:not(:disabled):hover]:[background:var(--color-primary-dark)] btn-block w-full justify-center"} disabled={register.isPending}>
                {register.isPending ? '注册中…' : '注册并登录'}
              </button>
            </form>
            {config?.githubEnabled && (
              <>
                <div className={"auth-divider flex items-center [gap:10px] [margin:14px_0_10px] [font-size:0.82rem] [color:var(--color-muted)] [&::before]:[content:''] [&::before]:flex-1 [&::before]:[height:1px] [&::before]:[background:var(--color-border)] [&::after]:[content:''] [&::after]:flex-1 [&::after]:[height:1px] [&::after]:[background:var(--color-border)]"}>或</div>
                <a className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)] btn-block w-full justify-center"} href="/api/auth/github">使用 GitHub 登录</a>
              </>
            )}
          </>
        )}
        <p className={"auth-switch [margin:16px_0_0] [font-size:0.88rem] [color:var(--color-muted)]"}>
          已有账号？<Link to="/login">直接登录</Link>
        </p>
      </div>
    </div>
  );
}
