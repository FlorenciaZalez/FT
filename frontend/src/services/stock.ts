import api from '../api/api';

export interface StockItem {
  product_id: number;
  product_name: string;
  sku: string;
  client_id: number;
  client_name: string;
  quantity: number;
  quantity_total: number;
  quantity_reserved: number;
  quantity_available: number;
  min_stock_alert: number;
}

export interface StockInPayload {
  product_id: number;
  quantity: number;
  reason?: string;
}

export interface StockOutPayload {
  product_id: number;
  quantity: number;
  reason?: string;
}

export interface StockMoveResult {
  product_id: number;
  product_name: string;
  sku: string;
  new_quantity: number;
}

export interface StockFilters {
  search?: string;
  clientId?: number | null;
  status?: 'available' | 'out_of_stock' | 'low_stock' | '';
}

export async function fetchStock(filters: StockFilters = {}): Promise<StockItem[]> {
  const params: Record<string, string | number> = {};
  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.clientId) params.client_id = filters.clientId;
  if (filters.status) params.status = filters.status;
  const { data } = await api.get<StockItem[]>('/stock', { params });
  return data;
}

export async function stockIn(payload: StockInPayload): Promise<StockMoveResult> {
  const { data } = await api.post<StockMoveResult>('/stock/in', payload);
  return data;
}

export async function stockOut(payload: StockOutPayload): Promise<StockMoveResult> {
  const { data } = await api.post<StockMoveResult>('/stock/out', payload);
  return data;
}

export interface StockSummaryItem {
  product_id: number;
  product_name: string;
  sku: string;
  location_code: string;
  quantity_total: number;
  quantity_reserved: number;
  quantity_available: number;
  min_stock_alert: number;
}

export async function fetchStockSummary(): Promise<StockSummaryItem[]> {
  const { data } = await api.get<StockSummaryItem[]>('/stock/summary');
  return data;
}

export interface StockMovement {
  id: number;
  client_id: number;
  product_id: number;
  movement_type: string;
  quantity: number;
  reference_type: string;
  reference_id: number | null;
  performed_by: number | null;
  performed_by_name: string | null;
  notes: string | null;
  created_at: string;
}

export async function fetchStockMovements(limit = 200): Promise<StockMovement[]> {
  const { data } = await api.get<StockMovement[]>('/stock/movements', { params: { limit } });
  return data;
}

export async function fetchMovementsByProduct(productId: number, limit = 50): Promise<StockMovement[]> {
  const { data } = await api.get<StockMovement[]>('/stock/movements', {
    params: { product_id: productId, limit },
  });
  return data;
}
