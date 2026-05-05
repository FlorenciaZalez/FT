import api from '../api/api';

export type ShippingCordon = 'cordon_1' | 'cordon_2' | 'cordon_3';
export type ShippingCategory = 'A' | 'B' | 'C';
export type ShippingWeightCategory = 'simple' | 'intermedio' | 'premium';

export interface PostalCodeRange {
  id: number;
  cp_from: number;
  cp_to: number;
  cordon: ShippingCordon;
  created_at: string;
  updated_at: string;
}

export interface PostalCodeRangePayload {
  cp_from: number;
  cp_to: number;
  cordon: ShippingCordon;
}

export interface ShippingRate {
  id: number;
  shipping_category: ShippingCategory;
  cordon: ShippingCordon;
  price: number;
  created_at: string;
  updated_at: string;
}

export interface ShippingRatePayload {
  shipping_category: ShippingCategory;
  cordon: ShippingCordon;
  price: number;
}

export interface HandlingRate {
  id: number;
  weight_category: ShippingWeightCategory;
  price: number;
  created_at: string;
  updated_at: string;
}

export interface HandlingRatePayload {
  weight_category: ShippingWeightCategory;
  price: number;
}

export async function fetchPostalCodeRanges(): Promise<PostalCodeRange[]> {
  const { data } = await api.get<PostalCodeRange[]>('/shipping/postal-code-ranges');
  return data;
}

export async function createPostalCodeRange(payload: PostalCodeRangePayload): Promise<PostalCodeRange> {
  const { data } = await api.post<PostalCodeRange>('/shipping/postal-code-ranges', payload);
  return data;
}

export async function updatePostalCodeRange(id: number, payload: Partial<PostalCodeRangePayload>): Promise<PostalCodeRange> {
  const { data } = await api.put<PostalCodeRange>(`/shipping/postal-code-ranges/${id}`, payload);
  return data;
}

export async function deletePostalCodeRange(id: number): Promise<void> {
  await api.delete(`/shipping/postal-code-ranges/${id}`);
}

export async function fetchShippingRates(): Promise<ShippingRate[]> {
  const { data } = await api.get<ShippingRate[]>('/shipping/rates');
  return data;
}

export async function createShippingRate(payload: ShippingRatePayload): Promise<ShippingRate> {
  const { data } = await api.post<ShippingRate>('/shipping/rates', payload);
  return data;
}

export async function updateShippingRate(id: number, payload: Partial<ShippingRatePayload>): Promise<ShippingRate> {
  const { data } = await api.put<ShippingRate>(`/shipping/rates/${id}`, payload);
  return data;
}

export async function deleteShippingRate(id: number): Promise<void> {
  await api.delete(`/shipping/rates/${id}`);
}

export async function fetchHandlingRates(): Promise<HandlingRate[]> {
  const { data } = await api.get<HandlingRate[]>('/shipping/handling-rates');
  return data;
}

export async function createHandlingRate(payload: HandlingRatePayload): Promise<HandlingRate> {
  const { data } = await api.post<HandlingRate>('/shipping/handling-rates', payload);
  return data;
}

export async function updateHandlingRate(id: number, payload: Partial<HandlingRatePayload>): Promise<HandlingRate> {
  const { data } = await api.put<HandlingRate>(`/shipping/handling-rates/${id}`, payload);
  return data;
}

export async function deleteHandlingRate(id: number): Promise<void> {
  await api.delete(`/shipping/handling-rates/${id}`);
}