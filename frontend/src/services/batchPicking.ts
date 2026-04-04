import api from '../api/api';

export interface BatchPickingAssignment {
  id: number;
  order_id: number;
  order_item_id: number;
  order_number: string;
  location_code: string | null;
  quantity_total: number;
  quantity_picked: number;
  is_complete: boolean;
}

export interface BatchPickingSessionItem {
  id: number;
  product_id: number | null;
  product_name: string;
  sku: string;
  quantity_total: number;
  quantity_picked: number;
  location_codes: string[];
  is_complete: boolean;
  pending_assignments: BatchPickingAssignment[];
}

export interface BatchPickingSession {
  id: number;
  status: string;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
  completed_at: string | null;
  total_units: number;
  picked_units: number;
  is_complete: boolean;
  items: BatchPickingSessionItem[];
}

export interface BatchPickingScanResult {
  success: boolean;
  scanned_sku: string;
  assigned_order_id: number;
  assigned_order_number: string;
  item_picked: number;
  item_total: number;
  sku_completed: boolean;
  session_completed: boolean;
  session: BatchPickingSession;
}

export async function startBatchPickingSession(): Promise<BatchPickingSession> {
  const { data } = await api.post<BatchPickingSession>('/orders/batch-picking/start');
  return data;
}

export async function fetchActiveBatchPickingSession(): Promise<BatchPickingSession> {
  const { data } = await api.get<BatchPickingSession>('/orders/batch-picking/active');
  return data;
}

export async function fetchBatchPickingSession(sessionId: number): Promise<BatchPickingSession> {
  const { data } = await api.get<BatchPickingSession>(`/orders/batch-picking/sessions/${sessionId}`);
  return data;
}

export async function scanBatchPickingSession(sessionId: number, sku: string): Promise<BatchPickingScanResult> {
  const { data } = await api.post<BatchPickingScanResult>(`/orders/batch-picking/sessions/${sessionId}/scan`, { sku });
  return data;
}