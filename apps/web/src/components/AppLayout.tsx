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
        <Link to="/trips" className="brand">
          织程 <span className="brand-en">TripWeaver</span>
        </Link>
        <div className="topbar-actions">
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
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      {settingsOpen && <SettingsDialog email={me.data?.email ?? ''} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
