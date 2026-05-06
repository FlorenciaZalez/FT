import api from '../api/api';
import axios from 'axios';

export interface MLAccount {
  id: number;
  client_id: number;
  ml_user_id: string;
  ml_nickname: string | null;
  connected_at: string;
  token_expires_at: string | null;
}

export interface MLMapping {
  id: number;
  client_id: number;
  product_id: number;
  ml_item_id: string;
  ml_variation_id: string | null;
  ml_account_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MLMappingCreateResult {
  success: boolean;
  reconciled_orders: number;
  mapping: MLMapping;
}

export interface MLMappingPayload {
  client_id?: number;
  product_id: number;
  ml_item_id: string;
  ml_variation_id?: string | null;
  ml_account_id?: string | null;
}

export async function getMLAuthUrl(clientId: number): Promise<string> {
  const { data } = await api.get<{ auth_url: string }>('/integrations/ml/auth-url', {
    params: { client_id: clientId },
  });
  return data.auth_url;
}

export async function mlCallback(code: string, clientId: number): Promise<MLAccount> {
  const { data } = await api.post<MLAccount>('/integrations/ml/callback', {
    code,
    client_id: clientId,
  });
  return data;
}

export async function getMLAccount(clientId: number): Promise<MLAccount> {
  const { data } = await api.get<MLAccount>(`/integrations/ml/account/${clientId}`);
  return data;
}

export async function disconnectMLAccount(clientId: number): Promise<void> {
  await api.delete(`/integrations/ml/account/${clientId}`);
}

export async function fetchMLMappings(): Promise<MLMapping[]> {
  const { data } = await api.get<MLMapping[]>('/integrations/ml/mappings');
  return data;
}

export async function createMLMapping(payload: MLMappingPayload): Promise<MLMappingCreateResult> {
  const { data } = await api.post<MLMappingCreateResult>('/integrations/ml/mappings', payload);
  return data;
}

export async function updateMLMapping(id: number, payload: Partial<MLMappingPayload & { is_active: boolean }>): Promise<MLMapping> {
  const { data } = await api.put<MLMapping>(`/integrations/ml/mappings/${id}`, payload);
  return data;
}

export async function deleteMLMapping(id: number): Promise<void> {
  await api.delete(`/integrations/ml/mappings/${id}`);
}

export interface MLImportResult {
  total_found: number;
  imported: number;
  skipped_duplicate: number;
  skipped_other: number;
  failed: number;
  errors: string[];
}

export async function importMLOrders(
  clientId: number,
  dateFrom: string,
  dateTo: string,
): Promise<MLImportResult> {
  const { data } = await api.post<MLImportResult>('/integrations/ml/import', {
    client_id: clientId,
    date_from: dateFrom,
    date_to: dateTo,
  });
  return data;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}
