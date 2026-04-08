import axios from 'axios';

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const defaultBaseUrl = import.meta.env.DEV ? '/api/v1' : 'https://stock-backend.onrender.com/api/v1';
const apiBaseUrl = (configuredBaseUrl && configuredBaseUrl.length > 0
  ? configuredBaseUrl
  : defaultBaseUrl).replace(/\/$/, '');

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
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
