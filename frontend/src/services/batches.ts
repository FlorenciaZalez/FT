import api from '../api/api';
import type { Order } from './orders';

export interface DispatchBatch {
  id: number;
  batch_number: string;
  carrier: string | null;
  transporter_id: number | null;
  transporter_name: string | null;
  notes: string | null;
  dispatched_by: number | null;
  order_count: number;
  created_at: string;
  orders?: Order[];
}

export async function fetchBatches(): Promise<DispatchBatch[]> {
  const { data } = await api.get<DispatchBatch[]>('/orders/batches');
  return data;
}

export async function fetchBatch(id: number): Promise<DispatchBatch> {
  const { data } = await api.get<DispatchBatch>(`/orders/batches/${id}`);
  return data;
}
