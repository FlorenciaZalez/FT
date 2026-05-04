import api from '../api/api';
import { toFiniteNumber } from '../utils/billingFormat';

export interface BillingRates {
  id: number;
  storage_per_m3: number;
  preparation_base_fee: number;
  preparation_additional_fee: number;
  product_creation_fee: number;
  label_print_fee: number;
  transport_dispatch_fee: number;
  truck_unloading_fee: number;
  shipping_base: number;
  created_at: string;
  updated_at: string;
}

export interface ClientRate {
  id: number | null;
  client_id: number;
  client_name: string;
  storage_discount_pct: number | null;
  shipping_discount_pct: number | null;
  effective_storage_per_m3: number;
  effective_shipping_base: number;
  effective_storage_discount_pct: number;
  effective_shipping_discount_pct: number;
}

export interface BillingPreviewItem {
  client_id: number;
  client_name: string;
  period: string;
  total_m3: number;
  total_orders: number;
  storage_base_rate: number;
  storage_discount_pct: number;
  storage_rate: number;
  preparation_base_rate: number;
  preparation_discount_pct: number;
  preparation_rate: number;
  shipping_base_amount: number;
  shipping_discount_pct: number;
  storage_amount: number;
  preparation_amount: number;
  product_creation_amount: number;
  product_creation_products: string[];
  label_print_amount: number;
  label_print_count: number;
  transport_dispatch_amount: number;
  transport_dispatch_count: number;
  transport_dispatch_transporters: string[];
  truck_unloading_amount: number;
  truck_unloading_count: number;
  manual_charge_amount: number;
  manual_charge_items: Array<{
    id: number;
    descripcion: string | null;
    tipo: string | null;
    fecha: string;
    monto: number;
  }>;
  shipping_amount: number;
  total: number;
  missing_storage: boolean;
}

export interface ClientStorageRecord {
  id: number;
  client_id: number;
  client_name: string;
  period: string;
  storage_m3: number;
  created_at: string;
  updated_at: string;
}

export interface ClientStorageRecordCreatePayload {
  client_id: number;
  period: string;
  storage_m3: number;
}

export interface ClientStorageRecordUpdatePayload {
  storage_m3: number;
}

export interface Charge {
  id: number;
  client_id: number;
  client_name: string | null;
  period: string;
  total_m3: number;
  total_orders: number;
  base_storage_rate: number;
  storage_discount_pct: number;
  applied_storage_rate: number;
  base_preparation_rate: number;
  preparation_discount_pct: number;
  applied_preparation_rate: number;
  applied_shipping_base: number;
  applied_shipping_multiplier: number;
  shipping_base_amount: number;
  shipping_discount_pct: number;
  storage_amount: number;
  preparation_amount: number;
  product_creation_amount: number;
  label_print_amount: number;
  transport_dispatch_amount: number;
  truck_unloading_amount: number;
  manual_charge_amount: number;
  shipping_amount: number;
  total: number;
  status: 'pending' | 'paid' | 'cancelled';
  due_date: string;
  created_at: string;
  updated_at: string;
}

export interface BillingDocument {
  id: number;
  client_id: number;
  client_name: string;
  period: string;
  storage_total: number;
  preparation_total: number;
  product_creation_total: number;
  label_print_total: number;
  transport_dispatch_total: number;
  truck_unloading_total: number;
  manual_charge_total: number;
  shipping_total: number;
  total: number;
  status: 'pending' | 'paid' | 'overdue';
  due_date: string;
  created_at: string;
  updated_at: string;
}

export interface BillingAlertSummary {
  due_soon_count: number;
  due_soon_days: number;
  overdue_count: number;
  due_soon_documents: BillingDocument[];
  overdue_documents: BillingDocument[];
}

export interface GenerateBillingDocumentsResponse {
  period: string;
  generated_count: number;
  total_amount: number;
  documents: BillingDocument[];
}

export interface GenerateChargesResponse {
  period: string;
  generated_count: number;
  total_amount: number;
  charges: Charge[];
}

export interface ChargeFilters {
  period?: string;
  client_id?: number;
  due_date_from?: string;
  due_date_to?: string;
  status?: 'pending' | 'paid';
}

export interface BillingDocumentFilters {
  period?: string;
  client_id?: number;
  status?: 'pending' | 'paid' | 'overdue';
}

function normalizeBillingRates(data: BillingRates): BillingRates {
  return {
    ...data,
    storage_per_m3: toFiniteNumber(data.storage_per_m3),
    preparation_base_fee: toFiniteNumber(data.preparation_base_fee),
    preparation_additional_fee: toFiniteNumber(data.preparation_additional_fee),
    product_creation_fee: toFiniteNumber(data.product_creation_fee),
    label_print_fee: toFiniteNumber(data.label_print_fee),
    transport_dispatch_fee: toFiniteNumber(data.transport_dispatch_fee),
    truck_unloading_fee: toFiniteNumber(data.truck_unloading_fee),
    shipping_base: toFiniteNumber(data.shipping_base),
  };
}

function normalizeClientRate(data: ClientRate): ClientRate {
  return {
    ...data,
    storage_discount_pct: data.storage_discount_pct == null ? null : toFiniteNumber(data.storage_discount_pct),
    shipping_discount_pct: data.shipping_discount_pct == null ? null : toFiniteNumber(data.shipping_discount_pct),
    effective_storage_per_m3: toFiniteNumber(data.effective_storage_per_m3),
    effective_shipping_base: toFiniteNumber(data.effective_shipping_base),
    effective_storage_discount_pct: toFiniteNumber(data.effective_storage_discount_pct),
    effective_shipping_discount_pct: toFiniteNumber(data.effective_shipping_discount_pct),
  };
}

function normalizeBillingPreviewItem(data: BillingPreviewItem): BillingPreviewItem {
  return {
    ...data,
    total_m3: toFiniteNumber(data.total_m3),
    total_orders: Math.trunc(toFiniteNumber(data.total_orders)),
    storage_base_rate: toFiniteNumber(data.storage_base_rate),
    storage_discount_pct: toFiniteNumber(data.storage_discount_pct),
    storage_rate: toFiniteNumber(data.storage_rate),
    preparation_base_rate: toFiniteNumber(data.preparation_base_rate),
    preparation_discount_pct: toFiniteNumber(data.preparation_discount_pct),
    preparation_rate: toFiniteNumber(data.preparation_rate),
    shipping_base_amount: toFiniteNumber(data.shipping_base_amount),
    shipping_discount_pct: toFiniteNumber(data.shipping_discount_pct),
    storage_amount: toFiniteNumber(data.storage_amount),
    preparation_amount: toFiniteNumber(data.preparation_amount),
    product_creation_amount: toFiniteNumber(data.product_creation_amount),
    label_print_amount: toFiniteNumber(data.label_print_amount),
    label_print_count: Math.trunc(toFiniteNumber(data.label_print_count)),
    product_creation_products: Array.isArray(data.product_creation_products) ? data.product_creation_products : [],
    transport_dispatch_amount: toFiniteNumber(data.transport_dispatch_amount),
    transport_dispatch_count: Math.trunc(toFiniteNumber(data.transport_dispatch_count)),
    transport_dispatch_transporters: Array.isArray(data.transport_dispatch_transporters) ? data.transport_dispatch_transporters : [],
    truck_unloading_amount: toFiniteNumber(data.truck_unloading_amount),
    truck_unloading_count: Math.trunc(toFiniteNumber(data.truck_unloading_count)),
    manual_charge_amount: toFiniteNumber(data.manual_charge_amount),
    manual_charge_items: Array.isArray(data.manual_charge_items)
      ? data.manual_charge_items.map((item) => ({
          id: Math.trunc(toFiniteNumber(item.id)),
          descripcion: item.descripcion ?? null,
          tipo: item.tipo ?? null,
          fecha: item.fecha,
          monto: toFiniteNumber(item.monto),
        }))
      : [],
    shipping_amount: toFiniteNumber(data.shipping_amount),
    total: toFiniteNumber(data.total),
    missing_storage: Boolean(data.missing_storage),
  };
}

function normalizeCharge(data: Charge): Charge {
  return {
    ...data,
    total_m3: toFiniteNumber(data.total_m3),
    total_orders: Math.trunc(toFiniteNumber(data.total_orders)),
    base_storage_rate: toFiniteNumber(data.base_storage_rate),
    storage_discount_pct: toFiniteNumber(data.storage_discount_pct),
    applied_storage_rate: toFiniteNumber(data.applied_storage_rate),
    base_preparation_rate: toFiniteNumber(data.base_preparation_rate),
    preparation_discount_pct: toFiniteNumber(data.preparation_discount_pct),
    applied_preparation_rate: toFiniteNumber(data.applied_preparation_rate),
    applied_shipping_base: toFiniteNumber(data.applied_shipping_base),
    applied_shipping_multiplier: toFiniteNumber(data.applied_shipping_multiplier, 1),
    shipping_base_amount: toFiniteNumber(data.shipping_base_amount),
    shipping_discount_pct: toFiniteNumber(data.shipping_discount_pct),
    storage_amount: toFiniteNumber(data.storage_amount),
    preparation_amount: toFiniteNumber(data.preparation_amount),
    product_creation_amount: toFiniteNumber(data.product_creation_amount),
    label_print_amount: toFiniteNumber(data.label_print_amount),
    transport_dispatch_amount: toFiniteNumber(data.transport_dispatch_amount),
    truck_unloading_amount: toFiniteNumber(data.truck_unloading_amount),
    manual_charge_amount: toFiniteNumber(data.manual_charge_amount),
    shipping_amount: toFiniteNumber(data.shipping_amount),
    total: toFiniteNumber(data.total),
  };
}

function normalizeBillingDocument(data: BillingDocument): BillingDocument {
  return {
    ...data,
    storage_total: toFiniteNumber(data.storage_total),
    preparation_total: toFiniteNumber(data.preparation_total),
    product_creation_total: toFiniteNumber(data.product_creation_total),
    label_print_total: toFiniteNumber(data.label_print_total),
    transport_dispatch_total: toFiniteNumber(data.transport_dispatch_total),
    truck_unloading_total: toFiniteNumber(data.truck_unloading_total),
    manual_charge_total: toFiniteNumber(data.manual_charge_total),
    shipping_total: toFiniteNumber(data.shipping_total),
    total: toFiniteNumber(data.total),
  };
}

export async function fetchGlobalBillingRates(): Promise<BillingRates> {
  const { data } = await api.get<BillingRates>('/billing/rates/global');
  return normalizeBillingRates(data);
}

export async function updateGlobalBillingRates(
  payload: Pick<BillingRates, 'storage_per_m3' | 'preparation_base_fee' | 'preparation_additional_fee' | 'product_creation_fee' | 'label_print_fee' | 'transport_dispatch_fee' | 'truck_unloading_fee' | 'shipping_base'>,
): Promise<BillingRates> {
  const { data } = await api.put<BillingRates>('/billing/rates/global', payload);
  return normalizeBillingRates(data);
}

export async function fetchClientBillingRates(): Promise<ClientRate[]> {
  const { data } = await api.get<ClientRate[]>('/billing/rates/clients');
  return data.map(normalizeClientRate);
}

export async function updateClientBillingRates(
  clientId: number,
  payload: { storage_discount_pct: number | null; shipping_discount_pct: number | null },
): Promise<ClientRate> {
  const { data } = await api.put<ClientRate>(`/billing/rates/clients/${clientId}`, payload);
  return normalizeClientRate(data);
}

export async function fetchBillingPreview(period: string): Promise<BillingPreviewItem[]> {
  const { data } = await api.get<BillingPreviewItem[]>('/billing/preview', { params: { period } });
  return data.map(normalizeBillingPreviewItem);
}

export async function fetchClientStorageRecords(params: { client_id?: number; period?: string } = {}): Promise<ClientStorageRecord[]> {
  const { data } = await api.get<ClientStorageRecord[]>('/billing/storage-records', { params });
  return data;
}

export async function createClientStorageRecord(payload: ClientStorageRecordCreatePayload): Promise<ClientStorageRecord> {
  const { data } = await api.post<ClientStorageRecord>('/billing/storage-records', payload);
  return data;
}

export async function updateClientStorageRecord(recordId: number, payload: ClientStorageRecordUpdatePayload): Promise<ClientStorageRecord> {
  const { data } = await api.put<ClientStorageRecord>(`/billing/storage-records/${recordId}`, payload);
  return data;
}

export async function deleteClientStorageRecord(recordId: number): Promise<void> {
  await api.delete(`/billing/storage-records/${recordId}`);
}

export async function generateBillingCharges(payload: { period: string; due_date?: string; overwrite?: boolean }): Promise<GenerateChargesResponse> {
  const { data } = await api.post<GenerateChargesResponse>('/billing/charges/generate', payload);
  return {
    ...data,
    total_amount: toFiniteNumber(data.total_amount),
    generated_count: Math.trunc(toFiniteNumber(data.generated_count)),
    charges: data.charges.map(normalizeCharge),
  };
}

export async function fetchCharges(filters: ChargeFilters = {}): Promise<Charge[]> {
  const { data } = await api.get<Charge[]>('/billing/charges', { params: filters });
  return data.map(normalizeCharge);
}

export async function fetchChargeDetail(chargeId: number): Promise<Charge> {
  const { data } = await api.get<Charge>(`/billing/charges/${chargeId}`);
  return normalizeCharge(data);
}

export async function generateBillingDocuments(payload: { period: string; overwrite?: boolean }): Promise<GenerateBillingDocumentsResponse> {
  const { data } = await api.post<GenerateBillingDocumentsResponse>('/billing/generate', payload);
  return {
    ...data,
    total_amount: toFiniteNumber(data.total_amount),
    generated_count: Math.trunc(toFiniteNumber(data.generated_count)),
    documents: data.documents.map(normalizeBillingDocument),
  };
}

export async function generateSingleBillingDocument(clientId: number, payload: { period: string; overwrite?: boolean }): Promise<BillingDocument> {
  const { data } = await api.post<BillingDocument>(`/billing/generate/${clientId}`, payload);
  return normalizeBillingDocument(data);
}

export async function fetchBillingDocuments(filters: BillingDocumentFilters = {}): Promise<BillingDocument[]> {
  const { data } = await api.get<BillingDocument[]>('/billing/documents', { params: filters });
  return data.map(normalizeBillingDocument);
}

export async function fetchBillingAlerts(): Promise<BillingAlertSummary> {
  const { data } = await api.get<BillingAlertSummary>('/billing/alerts');
  return {
    due_soon_count: Math.trunc(toFiniteNumber(data.due_soon_count)),
    due_soon_days: Math.trunc(toFiniteNumber(data.due_soon_days)),
    overdue_count: Math.trunc(toFiniteNumber(data.overdue_count)),
    due_soon_documents: data.due_soon_documents.map(normalizeBillingDocument),
    overdue_documents: data.overdue_documents.map(normalizeBillingDocument),
  };
}

export async function markBillingDocumentPaid(documentId: number): Promise<BillingDocument> {
  const { data } = await api.post<BillingDocument>(`/billing/documents/${documentId}/mark-paid`);
  return normalizeBillingDocument(data);
}

export interface PreparationRecord {
  id: number;
  client_id: number;
  client_name: string | null;
  order_id: number | null;
  product_id: number | null;
  order_item_id: number | null;
  cantidad_items: number;
  precio_base: number;
  precio_adicional: number;
  total: number;
  preparation_type: string;
  price_applied: number;
  recorded_at: string;
}

export interface PreparationRecordFilters {
  client_id?: number;
  period?: string;
  order_id?: number;
}

export interface ProductCreationRecord {
  id: number;
  client_id: number;
  client_name: string | null;
  product_id: number | null;
  product_name: string;
  sku: string;
  price_applied: number;
  created_at: string;
}

export interface ProductCreationRecordFilters {
  client_id?: number;
  period?: string;
}

export interface TransportDispatchRecord {
  id: number;
  client_id: number;
  client_name: string | null;
  transportista: string;
  cantidad_pedidos: number;
  origen: string;
  costo_aplicado: number;
  fecha: string;
}

export interface TransportDispatchRecordFilters {
  client_id?: number;
  period?: string;
}

export interface TransportDispatchRecordCreatePayload {
  client_id: number;
  fecha: string;
  transportista: string;
  cantidad_pedidos: number;
}

export interface MerchandiseReceptionRecord {
  id: number;
  client_id: number;
  client_name: string | null;
  fecha: string;
  cantidad_camiones: number;
  observaciones: string | null;
  costo_unitario: number;
  costo_total: number;
  created_at: string;
}

export interface MerchandiseReceptionRecordFilters {
  client_id?: number;
  period?: string;
}

export interface MerchandiseReceptionRecordCreatePayload {
  client_id: number;
  fecha: string;
  cantidad_camiones: number;
  observaciones?: string;
}

export interface ManualCharge {
  id: number;
  client_id: number;
  client_name: string | null;
  monto: number;
  descripcion: string | null;
  tipo: string | null;
  fecha: string;
  periodo: string;
  created_at: string;
  is_locked: boolean;
}

export interface ManualChargeFilters {
  client_id?: number;
  period?: string;
}

export interface ManualChargeCreatePayload {
  client_id: number;
  monto: number;
  descripcion?: string;
  tipo?: string;
  fecha: string;
  periodo: string;
}

export async function fetchPreparationRecords(filters: PreparationRecordFilters = {}): Promise<PreparationRecord[]> {
  const { data } = await api.get<PreparationRecord[]>('/billing/preparation-records', { params: filters });
  return data.map((record) => ({
    ...record,
    cantidad_items: Math.trunc(toFiniteNumber(record.cantidad_items)),
    precio_base: toFiniteNumber(record.precio_base),
    precio_adicional: toFiniteNumber(record.precio_adicional),
    total: toFiniteNumber(record.total),
    price_applied: toFiniteNumber(record.price_applied),
  }));
}

export async function fetchProductCreationRecords(filters: ProductCreationRecordFilters = {}): Promise<ProductCreationRecord[]> {
  const { data } = await api.get<ProductCreationRecord[]>('/billing/product-creation-records', { params: filters });
  return data.map((record) => ({ ...record, price_applied: toFiniteNumber(record.price_applied) }));
}

export async function fetchTransportDispatchRecords(filters: TransportDispatchRecordFilters = {}): Promise<TransportDispatchRecord[]> {
  const { data } = await api.get<TransportDispatchRecord[]>('/billing/transport-dispatch-records', { params: filters });
  return data.map((record) => ({
    ...record,
    cantidad_pedidos: Math.trunc(toFiniteNumber(record.cantidad_pedidos)),
    costo_aplicado: toFiniteNumber(record.costo_aplicado),
  }));
}

export async function createTransportDispatchRecord(payload: TransportDispatchRecordCreatePayload): Promise<TransportDispatchRecord> {
  const { data } = await api.post<TransportDispatchRecord>('/billing/transport-dispatch-records', payload);
  return {
    ...data,
    cantidad_pedidos: Math.trunc(toFiniteNumber(data.cantidad_pedidos)),
    costo_aplicado: toFiniteNumber(data.costo_aplicado),
  };
}

export async function deleteTransportDispatchRecord(recordId: number): Promise<void> {
  await api.delete(`/billing/transport-dispatch-records/${recordId}`);
}

export async function fetchMerchandiseReceptionRecords(filters: MerchandiseReceptionRecordFilters = {}): Promise<MerchandiseReceptionRecord[]> {
  const { data } = await api.get<MerchandiseReceptionRecord[]>('/billing/merchandise-reception-records', { params: filters });
  return data.map((record) => ({
    ...record,
    cantidad_camiones: Math.trunc(toFiniteNumber(record.cantidad_camiones)),
    costo_unitario: toFiniteNumber(record.costo_unitario),
    costo_total: toFiniteNumber(record.costo_total),
  }));
}

export async function createMerchandiseReceptionRecord(payload: MerchandiseReceptionRecordCreatePayload): Promise<MerchandiseReceptionRecord> {
  const { data } = await api.post<MerchandiseReceptionRecord>('/billing/merchandise-reception-records', payload);
  return {
    ...data,
    cantidad_camiones: Math.trunc(toFiniteNumber(data.cantidad_camiones)),
    costo_unitario: toFiniteNumber(data.costo_unitario),
    costo_total: toFiniteNumber(data.costo_total),
  };
}

export async function deleteMerchandiseReceptionRecord(recordId: number): Promise<void> {
  await api.delete(`/billing/merchandise-reception-records/${recordId}`);
}

export async function fetchManualCharges(filters: ManualChargeFilters = {}): Promise<ManualCharge[]> {
  const { data } = await api.get<ManualCharge[]>('/billing/manual-charges', { params: filters });
  return data.map((record) => ({
    ...record,
    monto: toFiniteNumber(record.monto),
    is_locked: Boolean(record.is_locked),
  }));
}

export async function createManualCharge(payload: ManualChargeCreatePayload): Promise<ManualCharge> {
  const { data } = await api.post<ManualCharge>('/billing/manual-charges', payload);
  return {
    ...data,
    monto: toFiniteNumber(data.monto),
    is_locked: Boolean(data.is_locked),
  };
}

export async function deleteManualCharge(chargeId: number): Promise<void> {
  await api.delete(`/billing/manual-charges/${chargeId}`);
}