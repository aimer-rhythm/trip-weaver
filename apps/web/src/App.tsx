import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { onUnauthorized, shouldRetryQuery } from './api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: shouldRetryQuery },
    mutations: { retry: false },
  },
});

const unsubscribe = onUnauthorized(() => {
  const { pathname, search, hash } = router.state.location;
  if (pathname === '/login' || pathname === '/register') return;
  queryClient.clear();
  sessionStorage.removeItem('tw.activeJobId');
  void router.navigate('/login', { replace: true, state: { from: pathname + search + hash } });
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
