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
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'client' && !isClientAllowedPath(location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
