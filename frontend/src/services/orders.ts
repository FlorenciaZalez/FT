import api from '../api/api';

export interface OrderItem {
  id: number;
  product_id: number;
  sku: string;
  product_name: string | null;
  product_image_url: string | null;
  quantity: number;
  picked_quantity: number;
  location_code: string | null;
}

export interface ReturnReception {
  id: number;
  order_item_id: number;
  sku: string;
  quantity: number;
  condition: string;
  notes: string | null;
  stock_location_code: string | null;
  received_by: number | null;
  received_by_name: string | null;
  received_at: string;
}

export interface Order {
  id: number;
  client_id: number;
  client_name: string | null;
  order_number: string;
  source: string;
  operation_type: string;
  display_operation_type: string;
  exchange_id?: string | null;
  source_order_id?: string | null;
  external_id?: string | null;
  shipping_id?: string | null;
  ml_item_id?: string | null;
  variation_id?: string | null;
  requested_quantity?: number | null;
  mapping_status?: string | null;
  status: string;
  shipping_label_url?: string | null;
  tracking_number?: string | null;
  label_printed: boolean;
  label_printed_at: string | null;
  label_print_count: number;
  label_generated: boolean;
  label_generated_at: string | null;
  label_type: string | null;
  buyer_name: string | null;
  buyer_address: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  cordon: string | null;
  shipping_cost: number | null;
  shipping_status: string | null;
  address_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
  cancelled_at: string | null;
  dispatch_batch_id: number | null;
  dispatch_batch_number: string | null;
  dispatch_carrier: string | null;
  dispatch_transporter_id: number | null;
  dispatch_transporter_name: string | null;
  dominant_zone: string | null;
  assigned_operator_id: number | null;
  assigned_operator_name: string | null;
  items: OrderItem[];
  return_receptions: ReturnReception[];
}

export interface OrderCreateItem {
  product_id: number;
  quantity: number;
}

export interface OrderCreatePayload {
  client_id: number;
  operation_type?: 'sale' | 'return' | 'exchange';
  items?: OrderCreateItem[];
  delivery_items?: OrderCreateItem[];
  return_items?: OrderCreateItem[];
  source?: string;
  source_order_id?: string;
  external_id?: string;
  shipping_id?: string;
  ml_item_id?: string;
  variation_id?: string;
  quantity?: number;
  zip_code?: string;
  buyer_name?: string;
  address_line?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  address_reference?: string;
  notes?: string;
}

export interface OrderUpdatePayload {
  external_id?: string | null;
  shipping_id?: string | null;
  ml_item_id?: string | null;
  variation_id?: string | null;
  quantity?: number | null;
  zip_code?: string | null;
  items?: OrderCreateItem[];
  buyer_name?: string | null;
  buyer_address?: string | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  address_reference?: string | null;
  shipping_label_url?: string | null;
  notes?: string | null;
}

export async function fetchOrders(status?: string, dominant_zone?: string, mappingStatus?: string, source?: string): Promise<Order[]> {
  const params: Record<string, string> = {};
  if (status) params.status = status;
  if (dominant_zone) params.dominant_zone = dominant_zone;
  if (mappingStatus) params.mapping_status = mappingStatus;
  if (source) params.source = source;
  const { data } = await api.get<Order[]>('/orders', { params });
  return data;
}

export async function fetchOrder(id: number): Promise<Order> {
  const { data } = await api.get<Order>(`/orders/${id}`);
  return data;
}

export async function fetchReturnOrders(): Promise<Order[]> {
  const [awaitingReturn, pendingReview] = await Promise.all([
    fetchOrders('awaiting_return'),
    fetchOrders('returned_pending_review'),
  ]);
  return [...awaitingReturn, ...pendingReview].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

export async function createOrder(payload: OrderCreatePayload): Promise<Order> {
  const { data } = await api.post<Order>('/orders', payload);
  return data;
}

export async function updateOrder(id: number, payload: OrderUpdatePayload): Promise<Order> {
  const { data } = await api.put<Order>(`/orders/${id}`, payload);
  return data;
}

export async function resolveMarketplaceOrderMapping(orderId: number, productId: number): Promise<Order> {
  const { data } = await api.post<Order>(`/orders/${orderId}/resolve-mapping`, { product_id: productId });
  return data;
}

export async function markOrderAwaitingReturn(orderId: number, notes?: string): Promise<Order> {
  const { data } = await api.post<Order>(`/orders/${orderId}/mark-awaiting-return`, {
    notes: notes || undefined,
  });
  return data;
}

export interface ReceiveReturnPayload {
  order_id: number;
  sku: string;
  condition: 'good' | 'damaged' | 'review';
  notes?: string;
}

export interface ReceiveReturnResult {
  order: Order;
  reception: ReturnReception;
}

export async function receiveReturn(payload: ReceiveReturnPayload): Promise<ReceiveReturnResult> {
  const { data } = await api.post<ReceiveReturnResult>('/returns/receive', payload);
  return data;
}

export async function advanceOrder(id: number): Promise<Order> {
  const { data } = await api.post<Order>(`/orders/${id}/advance`);
  return data;
}

export async function cancelOrder(id: number): Promise<Order> {
  const { data } = await api.post<Order>(`/orders/${id}/cancel`);
  return data;
}

export interface PickBySkuResult {
  success: boolean;
  scanned_sku: string;
  item_picked: number;
  item_total: number;
  all_picked: boolean;
  order: Order;
}

export async function pickBySku(orderId: number, sku: string): Promise<PickBySkuResult> {
  const { data } = await api.post<PickBySkuResult>(`/orders/${orderId}/pick-sku`, { sku });
  return data;
}

export async function fetchPickableOrders(): Promise<Order[]> {
  const pending = await fetchOrders('pending');
  const inPrep = await fetchOrders('in_preparation');
  return [...pending, ...inPrep];
}

export interface BatchDispatchPayload {
  order_ids: number[];
  carrier?: string;
  transporter_id?: number;
  notes?: string;
  register_transport_transfer?: boolean;
}

export interface BatchDispatchResult {
  batch_id: number;
  batch_number: string;
  order_count: number;
  carrier: string | null;
  transporter_id: number | null;
  dispatched_at: string;
  orders: Order[];
}

export async function batchDispatch(payload: BatchDispatchPayload): Promise<BatchDispatchResult> {
  const { data } = await api.post<BatchDispatchResult>('/orders/batch-dispatch', payload);
  return data;
}

export interface LabelPrintJobResult {
  generatedCount: number;
  failedCount: number;
  fileName: string;
  mode: string;
}

function getHeader(headers: Record<string, string>, key: string): string | null {
  const direct = headers[key];
  if (direct) return direct;
  const lower = headers[key.toLowerCase()];
  return lower ?? null;
}

function parseFileName(headers: Record<string, string>, fallback: string): string {
  const explicit = getHeader(headers, 'x-labels-file-name');
  if (explicit) return explicit;

  const disposition = getHeader(headers, 'content-disposition');
  if (!disposition) return fallback;

  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

function triggerPdfDownload(blob: Blob, fileName: string): void {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

async function requestLabelPdf(url: string, fallbackFileName: string): Promise<LabelPrintJobResult> {
  const response = await api.post<Blob>(url, undefined, { responseType: 'blob' });
  const fileName = parseFileName(response.headers as Record<string, string>, fallbackFileName);
  triggerPdfDownload(response.data, fileName);

  return {
    generatedCount: Number(getHeader(response.headers as Record<string, string>, 'x-labels-generated-count') ?? '0'),
    failedCount: Number(getHeader(response.headers as Record<string, string>, 'x-labels-failed-count') ?? '0'),
    fileName,
    mode: getHeader(response.headers as Record<string, string>, 'x-labels-mode') ?? 'unknown',
  };
}

export async function printPendingLabels(): Promise<LabelPrintJobResult> {
  return requestLabelPdf('/orders/print-pending-labels', 'etiquetas-pendientes.pdf');
}

export async function printOrderLabel(orderId: number): Promise<LabelPrintJobResult> {
  return requestLabelPdf(`/orders/${orderId}/print-label`, `etiqueta-${orderId}.pdf`);
}

export async function generateManualLabel(orderId: number): Promise<LabelPrintJobResult> {
  return requestLabelPdf(`/orders/${orderId}/generate-manual-label`, `etiqueta-manual-${orderId}.pdf`);
}

export async function scanSkuForDispatch(sku: string): Promise<Order[]> {
  const { data } = await api.get<Order[]>(`/orders/scan-sku/${encodeURIComponent(sku)}`);
  return data;
}

export async function fetchOrderByShipping(shippingId: string): Promise<Order> {
  const { data } = await api.get<Order>(`/orders/by-shipping/${encodeURIComponent(shippingId)}`);
  return data;
}

export async function dispatchOrder(orderId: number, trackingNumber?: string): Promise<Order> {
  const params = trackingNumber ? { tracking_number: trackingNumber } : undefined;
  const { data } = await api.post<Order>(`/orders/${orderId}/dispatch`, undefined, { params });
  return data;
}

export interface HelpZoneResult {
  assigned: number;
  zone: string | null;
  message: string;
}

export async function helpOtherZone(): Promise<HelpZoneResult> {
  const { data } = await api.post<HelpZoneResult>('/orders/help-zone');
  return data;
}

export interface WorkloadOperator {
  id: number;
  name: string;
  zones: string[];
  orders: number;
  pending_zone_orders: number;
  has_active_batch: boolean;
}

export interface ZonePending {
  zone: string;
  pending: number;
}

export interface WorkloadStatus {
  zones: ZonePending[];
  saturated_zones: ZonePending[];
  idle_operators: WorkloadOperator[];
  busy_operators: WorkloadOperator[];
  message: string | null;
}

export async function fetchWorkloadStatus(): Promise<WorkloadStatus> {
  const { data } = await api.get<WorkloadStatus>('/orders/workload-status');
  return data;
}

export interface WorkloadHint {
  available: boolean;
  pending_other_zones: number;
  message: string | null;
}

export async function fetchWorkloadHint(): Promise<WorkloadHint> {
  const { data } = await api.get<WorkloadHint>('/orders/workload-hint');
  return data;
}
