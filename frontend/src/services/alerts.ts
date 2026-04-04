import api from '../api/api';

export interface Alert {
  id: number;
  client_id: number | null;
  alert_type: string;
  severity: string;
  target_role: string;
  reference_type: string | null;
  reference_id: number | null;
  message: string;
  created_at: string;
}

export async function fetchAlerts(params?: {
  active_only?: boolean;
  alert_type?: string;
  severity?: string;
}): Promise<Alert[]> {
  const { data } = await api.get<Alert[]>('/alerts', { params });
  return data;
}

export async function fetchActiveCount(): Promise<number> {
  const { data } = await api.get<{ active: number }>('/alerts/count');
  return data.active;
}

export async function runAlertChecks(): Promise<number> {
  const { data } = await api.post<{ created: number }>('/alerts/check');
  return data.created;
}
