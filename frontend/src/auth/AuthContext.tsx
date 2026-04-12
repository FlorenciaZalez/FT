import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import api from '../api/api';

interface AuthState {
  token: string | null;
  user: { id: number; email: string; full_name: string; role: string; client_id: number | null; zones: string[] | null } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('access_token')
  );
  const [user, setUser] = useState<AuthState['user']>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() =>
    !!localStorage.getItem('access_token')
  );

  useEffect(() => {
    if (token && !user) {
      api
        .get('/auth/me')
        .then((res) => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('access_token');
          setToken(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [token, user]);

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const accessToken: string = res.data.access_token;
    localStorage.setItem('access_token', accessToken);
    setToken(accessToken);
    const me = await api.get('/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setUser(me.data);
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ token, user, isAuthenticated: !!token && !!user, isLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
