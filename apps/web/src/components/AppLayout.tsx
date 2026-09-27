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
    <div className="app-layout">
      <header className="topbar">
        <div className="topbar-capsule">
          <Link to="/" className="brand">
            <svg className="brand-mark" viewBox="0 0 34 24" aria-hidden="true">
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
            织程 <span className="brand-en">TripWeaver</span>
          </Link>
          <div className="topbar-actions">
            <Link to="/trips" className="btn btn-ghost">
              我的行程
            </Link>
            {usage.data && (
              <span className="quota-chip" title="每日生成次数将在次日零点重置">
                今日可生成 {usage.data.remaining}/{usage.data.dailyLimit} 次
              </span>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
              设置
            </button>
            <button
              type="button"
              className="btn btn-ghost"
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
      <main className="app-main">
        <Outlet />
      </main>
      {settingsOpen && <SettingsDialog email={me.data?.email ?? ''} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

