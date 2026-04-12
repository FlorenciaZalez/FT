import axios from 'axios';

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

const normalizeApiBaseUrl = (value: string) => {
  const sanitizedValue = value.replace(/\/$/, '');
  return sanitizedValue.endsWith('/api/v1') ? sanitizedValue : `${sanitizedValue}/api/v1`;
};

const apiBaseUrl = configuredApiUrl && configuredApiUrl.length > 0
  ? normalizeApiBaseUrl(configuredApiUrl)
  : '/api/v1';

const api = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      window.location.href = '/#/login';
    }
    return Promise.reject(error);
  }
);

export default api;
