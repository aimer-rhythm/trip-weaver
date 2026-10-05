import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { ApiError } from './api/client';
import { useMe } from './api/hooks';
import { AppLayout } from './components/AppLayout';

import { TripListPage } from './pages/TripListPage';
import { HomePage } from './pages/HomePage';
import { NewTripPage } from './pages/NewTripPage';
import { TripEditorPage } from './pages/TripEditorPage';

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return <div className={"page-loading [padding:20vh_16px] text-center [color:var(--color-muted)]"}>加载中…</div>;
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
    }
    return <div className={"page-loading [padding:20vh_16px] text-center [color:var(--color-muted)]"}>服务暂不可用，请稍后刷新重试</div>;
  }
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  return <Outlet />;
}

function LoginRedirect({ register = false }: { register?: boolean }) {
  const location = useLocation();
  const state: unknown = location.state;
  const from = typeof state === 'object' && state !== null && 'from' in state && typeof state.from === 'string' ? state.from : '/';
  return <Navigate to={`/${location.search}`} replace state={{ login: true, register, from }} />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginRedirect /> },
  { path: '/register', element: <LoginRedirect register /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/trips', element: <TripListPage /> },
          { path: '/trips/new', element: <NewTripPage /> },
          { path: '/trips/:id', element: <TripEditorPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
