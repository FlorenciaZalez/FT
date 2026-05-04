import api from '../api/api';

export type ProductWeightCategory = 'light' | 'heavy';
export type ProductPreparationType = 'simple' | 'especial';

export interface Product {
  id: number;
  client_id: number;
  client_name: string | null;
  name: string;
  sku: string;
  has_ml_mapping: boolean;
  ml_item_id: string | null;
  ml_item_ids: string[];
  barcode: string | null;
  description: string | null;
  weight_kg: number | null;
  preparation_type: ProductPreparationType;
  weight_category: ProductWeightCategory;
  width_cm: number | null;
  height_cm: number | null;
  depth_cm: number | null;
  volume_m3: number | null;
  location_id: number | null;
  location_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductCreatePayload {
  name: string;
  sku: string;
  client_id: number;
  ml_item_reference?: string | null;
  preparation_type?: ProductPreparationType;
  width_cm?: number | null;
  height_cm?: number | null;
  depth_cm?: number | null;
  volume_m3?: number | null;
  location_id?: number | null;
}

export interface ProductUpdatePayload {
  name?: string;
  sku?: string;
  ml_item_reference?: string | null;
  preparation_type?: ProductPreparationType;
  width_cm?: number | null;
  height_cm?: number | null;
  depth_cm?: number | null;
  volume_m3?: number | null;
  location_id?: number | null;
  is_active?: boolean;
}

export async function fetchProducts(limit = 1000): Promise<Product[]> {
  const { data } = await api.get<Product[]>('/products', { params: { limit } });
  return data;
}

export async function createProduct(payload: ProductCreatePayload): Promise<Product> {
  const { data } = await api.post<Product>('/products', payload);
  return data;
}

export async function updateProduct(id: number, payload: ProductUpdatePayload): Promise<Product> {
  const { data } = await api.put<Product>(`/products/${id}`, payload);
  return data;
}

export async function deleteProduct(id: number): Promise<void> {
  await api.delete(`/products/${id}`);
}

export async function recordFirstProductLabelPrint(id: number): Promise<{ recorded: boolean }> {
  const { data } = await api.post<{ recorded: boolean }>(`/products/${id}/record-first-label-print`);
  return data;
}
