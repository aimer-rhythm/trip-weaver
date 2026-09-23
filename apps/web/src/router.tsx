import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { ApiError } from './api/client';
import { useMe } from './api/hooks';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { TripListPage } from './pages/TripListPage';
import { ChatPage } from './pages/ChatPage';
import { TripEditorPage } from './pages/TripEditorPage';

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return <div className="page-loading">加载中…</div>;
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
    return <div className="page-loading">服务暂不可用，请稍后刷新重试</div>;
  }
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Navigate to="/trips" replace /> },
          { path: '/trips', element: <TripListPage /> },
          { path: '/trips/new', element: <ChatPage /> },
          { path: '/trips/:id', element: <TripEditorPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/trips" replace /> },
]);
