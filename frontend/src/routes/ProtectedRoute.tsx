import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const CLIENT_ALLOWED_PATH_PREFIXES = [
  '/dashboard',
  '/stock',
  '/orders',
  '/integrations/ml/callback',
];

function isClientAllowedPath(pathname: string): boolean {
  return CLIENT_ALLOWED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'client' && !isClientAllowedPath(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
