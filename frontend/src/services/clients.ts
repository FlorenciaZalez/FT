import api from '../api/api';

export interface MLAccountInfo {
  ml_user_id: string;
  ml_nickname: string | null;
  connected_at: string;
}

export interface BillingScheduleInfo {
  day_of_month: number;
  active: boolean;
}

export interface Client {
  id: number;
  name: string;
  business_name: string | null;
  tax_id: string | null;
  contact_email: string;
  contact_phone: string | null;
  contact_name: string | null;
  contact_phone_operational: string | null;
  plan: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  ml_account: MLAccountInfo | null;
  billing_schedule: BillingScheduleInfo | null;
}

export interface ClientCreatePayload {
  name: string;
  contact_email: string;
  business_name?: string;
  tax_id?: string;
  contact_phone?: string;
  contact_name?: string;
  contact_phone_operational?: string;
  plan?: string;
  billing_day_of_month?: number;
}

export interface ClientUpdatePayload {
  name?: string;
  business_name?: string;
  tax_id?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_name?: string;
  contact_phone_operational?: string;
  plan?: string;
  is_active?: boolean;
  billing_day_of_month?: number;
}

export async function fetchClients(): Promise<Client[]> {
  const { data } = await api.get<Client[]>('/clients');
  return data;
}

export async function fetchClient(id: number): Promise<Client> {
  const { data } = await api.get<Client>(`/clients/${id}`);
  return data;
}

export async function createClient(payload: ClientCreatePayload): Promise<Client> {
  const { data } = await api.post<Client>('/clients', payload);
  return data;
}

export async function updateClient(id: number, payload: ClientUpdatePayload): Promise<Client> {
  const { data } = await api.put<Client>(`/clients/${id}`, payload);
  return data;
}

export async function deleteClient(id: number): Promise<void> {
  await api.delete(`/clients/${id}`);
}
