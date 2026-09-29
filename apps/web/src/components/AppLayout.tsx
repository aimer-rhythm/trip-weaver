import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useLogout, useMe, useUsage } from '../api/hooks';
import { SettingsDialog } from './SettingsDialog';

export function AppLayout() {
  const me = useMe();
  const usage = useUsage();
  const logout = useLogout();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className={"app-layout [min-height:100vh] flex flex-col [background:var(--color-canvas)_url('/home-bg.png')_center_/_cover_no-repeat] [&:has(.home-page-root)_.app-main]:p-0 [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar]:[padding-top:12px] [@media_(max-width:_600px)]:[&:has(.editor-page)_.brand-en]:hidden [@media_(max-width:_600px)]:[&:has(.editor-page)_.quota-chip]:hidden [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-capsule]:[padding-left:12px] [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-actions]:[gap:0] [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-actions_.btn]:[padding:8px] [@media_(max-width:_600px)]:[&:has(.editor-page)_.topbar-actions_.btn]:[font-size:12px] [@media_screen]:[&:has(.editor-page)]:[height:100dvh] [@media_screen]:[&:has(.editor-page)]:min-h-0 [@media_screen]:[&:has(.editor-page)]:overflow-hidden [@media_screen]:[&:has(.editor-page)_.topbar]:shrink-0 [@media_screen]:[&:has(.editor-page)_.app-main]:overflow-hidden [@media_screen]:[&_.editor-page]:flex-1 [@media_screen]:[&_.editor-page]:[height:auto] [@media_screen]:[&_.editor-page]:[max-height:none] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.brand-en]:hidden [@media_(max-width:_600px)]:[&:has(.trip-collection)_.quota-chip]:hidden [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-capsule]:[padding-left:12px] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-actions]:[gap:0] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-actions_.btn]:[padding:8px] [@media_(max-width:_600px)]:[&:has(.trip-collection)_.topbar-actions_.btn]:[font-size:12px]"}>
      <header className={"topbar flex [padding:20px_2.5%_0] sticky [top:0] [z-index:20] [@media_(max-width:_768px)]:[padding:12px_12px_0]"}>
        <div className={"topbar-capsule flex-1 [height:56px] flex items-center justify-between [padding:0_10px_0_20px] [background:rgba(255,_255,_255,_0.62)] [backdrop-filter:blur(18px)_saturate(1.6)] [-webkit-backdrop-filter:blur(18px)_saturate(1.6)] [border:1px_solid_rgba(255,_255,_255,_0.75)] rounded-full [box-shadow:0_12px_32px_rgba(31,_64,_124,_0.1)]"}>
          <Link to="/" className={"brand flex items-center [gap:8px] font-bold [font-size:1.1rem] [color:var(--color-ink)]"}>
            <svg className={"brand-mark [width:30px] [height:22px] flex-none"} viewBox="0 0 34 24" aria-hidden="true">
              <defs>
                <linearGradient id="brand-wave" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#4f8ef7" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <path
                d="M3 16.5c3.6-8 7.2-8 10.8 0s7.2 8 10.8 0"
                fill="none"
                stroke="url(#brand-wave)"
                strokeWidth="4.4"
                strokeLinecap="round"
              />
              <path
                d="M7.6 8.6c2.4-5.2 4.8-5.2 7.2 0"
                fill="none"
                stroke="url(#brand-wave)"
                strokeWidth="3.4"
                strokeLinecap="round"
                opacity="0.7"
              />
            </svg>
            织程 <span className={"brand-en [color:var(--color-brand-en-color-1)] font-semibold"}>TripWeaver</span>
          </Link>
          <div className={"topbar-actions flex items-center [gap:8px]"}>
            <Link to="/trips" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)]"}>
              我的行程
            </Link>
            {usage.data && (
              <span className={"quota-chip [font-size:0.8rem] [color:var(--color-primary-dark)] [background:var(--color-quota-chip-background-2)] rounded-full [padding:4px_10px] [@media_(max-width:_768px)]:hidden"} title="每日生成次数将在次日零点重置">
                今日可生成 {usage.data.remaining}/{usage.data.dailyLimit} 次
              </span>
            )}
            <button type="button" className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)]"} onClick={() => setSettingsOpen(true)}>
              设置
            </button>
            <button
              type="button"
              className={"btn [border:1px_solid_transparent] [border-radius:var(--radius)] [padding:8px_14px] [font-size:0.9rem] cursor-pointer [color:var(--color-text)] inline-flex items-center [gap:4px] [&:disabled]:[opacity:0.55] [&:disabled]:[cursor:not-allowed] btn-ghost [border-color:var(--color-border)] [background:var(--color-card)] [&:not(:disabled):hover]:[border-color:var(--color-primary)] [&:not(:disabled):hover]:[color:var(--color-primary)]"}
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => navigate('/login', { replace: true }),
                })
              }
            >
              退出
            </button>
          </div>
        </div>
      </header>
      <main className={"app-main flex-1 flex flex-col min-h-0 [padding:0_2.5%] [@media_(max-width:_768px)]:[padding:0_12px]"}>
        <Outlet />
      </main>
      {settingsOpen && <SettingsDialog email={me.data?.email ?? ''} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

