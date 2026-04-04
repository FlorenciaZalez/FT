import { useState, useEffect, useMemo, useRef, useCallback, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeftRight, RotateCcw, ShoppingBag } from 'lucide-react';
import { useOrders } from '../hooks/useOrders';
import { useAuth } from '../auth/AuthContext';
import { fetchClients, type Client } from '../services/clients';
import { fetchProducts, type Product } from '../services/products';
import { fetchStock, type StockItem } from '../services/stock';
import {
  batchDispatch,
  generateManualLabel,
  helpOtherZone,
  fetchWorkloadHint,
  printOrderLabel,
  printPendingLabels,
  type Order,
  type OrderCreatePayload,
  type WorkloadHint,
} from '../services/orders';
import { fetchTransporters, type Transporter } from '../services/transporters';
import SuccessToast from '../components/SuccessToast';
import InfoTooltip from '../components/InfoTooltip';
import {
  fetchActiveBatchPickingSession,
  startBatchPickingSession,
  type BatchPickingSession,
} from '../services/batchPicking';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  in_preparation: 'Preparando pedido',
  prepared: 'Listo para despacho',
  dispatched: 'Despachado',
  awaiting_return: 'Esperando devolución',
  returned_pending_review: 'Devuelto pendiente de revisión',
  returned_completed: 'Devolución completada',
  cancelled: 'Cancelado',
};

const SHIPPING_STATUS_LABELS: Record<string, string> = {
  calculated: 'Calculado',
  zone_undefined: 'Zona no definida',
  rate_undefined: 'Costo logístico no definido',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  mercadolibre: 'MercadoLibre',
};

const LABEL_TYPE_LABELS: Record<string, string> = {
  manual: 'Etiqueta manual',
  external: 'Etiqueta externa',
};

const MAPPING_STATUS_LABELS: Record<string, string> = {
  resolved: 'Mapping resuelto',
  unmapped: 'Sin mapping',
};

const OPERATION_LABELS: Record<string, string> = {
  sale: 'Entrega',
  return: 'Retiro',
  exchange: 'Logística inversa',
};

const MAIN_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  in_preparation: 'En preparación',
  prepared: 'Preparado',
  dispatched: 'Despachado',
  awaiting_return: 'Esperando devolución',
  returned_pending_review: 'Pendiente de revisión',
  returned_completed: 'Devuelto',
  cancelled: 'Cancelado',
  error: 'Error',
};

const MAIN_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-800',
  in_preparation: 'bg-blue-50 text-blue-700',
  prepared: 'bg-blue-50 text-blue-700',
  dispatched: 'bg-green-50 text-green-700',
  awaiting_return: 'bg-yellow-50 text-yellow-800',
  returned_pending_review: 'bg-blue-50 text-blue-700',
  returned_completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
  error: 'bg-red-50 text-red-700',
};

type OperationRow = {
  key: string;
  orderIds: number[];
  displayType: 'sale' | 'return' | 'exchange';
  primaryOrder: Order;
  deliveryOrder: Order | null;
  returnOrder: Order | null;
};

function buildOperationRows(orders: Order[]): OperationRow[] {
  const rows: OperationRow[] = [];
  const seenExchangeIds = new Set<string>();

  for (const order of orders) {
    if (order.exchange_id) {
      if (seenExchangeIds.has(order.exchange_id)) continue;
      const groupedOrders = orders.filter((candidate) => candidate.exchange_id === order.exchange_id);
      const deliveryOrder = groupedOrders.find((candidate) => candidate.operation_type === 'sale') ?? null;
      const returnOrder = groupedOrders.find((candidate) => candidate.operation_type === 'return') ?? null;
      seenExchangeIds.add(order.exchange_id);
      rows.push({
        key: `exchange-${order.exchange_id}`,
        orderIds: groupedOrders.map((candidate) => candidate.id),
        displayType: deliveryOrder && returnOrder ? 'exchange' : ((deliveryOrder ?? returnOrder)?.operation_type as 'sale' | 'return'),
        primaryOrder: deliveryOrder ?? returnOrder ?? order,
        deliveryOrder,
        returnOrder,
      });
      continue;
    }

    rows.push({
      key: `order-${order.id}`,
      orderIds: [order.id],
      displayType: order.operation_type as 'sale' | 'return',
      primaryOrder: order,
      deliveryOrder: order.operation_type === 'sale' ? order : null,
      returnOrder: order.operation_type === 'return' ? order : null,
    });
  }

  return rows;
}

function isDispatchableOperation(row: OperationRow): boolean {
  if (row.displayType === 'exchange') {
    return row.deliveryOrder?.status === 'prepared' && row.returnOrder?.status === 'prepared';
  }
  return row.primaryOrder.status === 'prepared';
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
}

function getRowMainStatus(row: OperationRow): { label: string; className: string } {
  if (row.deliveryOrder?.mapping_status === 'unmapped') {
    return {
      label: MAIN_STATUS_LABELS.error,
      className: MAIN_STATUS_COLORS.error,
    };
  }

  const statusKey = row.primaryOrder.status;
  return {
    label: MAIN_STATUS_LABELS[statusKey] ?? STATUS_LABELS[statusKey] ?? statusKey,
    className: MAIN_STATUS_COLORS[statusKey] ?? 'bg-gray-50 text-gray-700',
  };
}

function getRowStatusDetails(row: OperationRow): string[] {
  const details: string[] = [];

  details.push(OPERATION_LABELS[row.displayType] ?? row.displayType);

  if (row.primaryOrder.source) {
    details.push(SOURCE_LABELS[row.primaryOrder.source] ?? row.primaryOrder.source);
  }

  if (row.primaryOrder.mapping_status) {
    details.push(MAPPING_STATUS_LABELS[row.primaryOrder.mapping_status] ?? row.primaryOrder.mapping_status);
  }

  if (row.displayType === 'exchange') {
    if (row.deliveryOrder) {
      details.push(`Entrega: ${STATUS_LABELS[row.deliveryOrder.status] ?? row.deliveryOrder.status}`);
    }
    if (row.returnOrder) {
      details.push(`Retiro: ${STATUS_LABELS[row.returnOrder.status] ?? row.returnOrder.status}`);
    }
  }

  return details.slice(0, 4);
}

function getShippingSummary(order: Order | null): { primary: string; details: string[] } {
  if (!order) {
    return { primary: '—', details: [] };
  }

  const details: string[] = [];

  if (order.cordon) {
    details.push(`Cordón ${order.cordon}`);
  }

  if (order.source === 'manual') {
    details.push('Manual');
  }

  if (order.shipping_status === 'zone_undefined') {
    details.push(SHIPPING_STATUS_LABELS.zone_undefined);
  } else if (order.shipping_status === 'rate_undefined') {
    details.push(SHIPPING_STATUS_LABELS.rate_undefined);
  } else if (order.shipping_cost === null || order.shipping_cost === undefined) {
    details.push('Sin costo calculado');
  }

  return {
    primary: order.shipping_cost !== null && order.shipping_cost !== undefined
      ? formatCurrency(order.shipping_cost)
      : 'Sin costo',
    details: details.slice(0, 3),
  };
}

function getDispatchSummary(
  primaryOrder: Order,
  deliveryOrder: Order | null,
  labelStatus: { text: string },
): { primary: string; details: string[] } {
  const details: string[] = [];

  if (primaryOrder.dispatch_batch_number) {
    details.push(`Código: ${primaryOrder.dispatch_batch_number}`);
  }

  if (labelStatus.text) {
    details.push(`Estado de etiqueta: ${labelStatus.text}`);
  }

  if (deliveryOrder?.label_generated_at) {
    details.push(`Fecha: ${new Date(deliveryOrder.label_generated_at).toLocaleString('es-AR')}`);
  }

  return {
    primary: primaryOrder.dispatch_transporter_name ?? primaryOrder.dispatch_carrier ?? '—',
    details,
  };
}

function getOperationIndicator(row: OperationRow): {
  icon: typeof ShoppingBag;
  label: string;
  className: string;
  tooltip: string[];
} {
  if (row.displayType === 'exchange') {
    return {
      icon: ArrowLeftRight,
      label: 'Cambio',
      className: 'border-blue-200 bg-blue-50 text-blue-700',
      tooltip: [
        'Operación de cambio',
        row.deliveryOrder ? `Entrega: ${row.deliveryOrder.order_number}` : '',
        row.returnOrder ? `Retiro: ${row.returnOrder.order_number}` : '',
      ].filter(Boolean),
    };
  }

  if (row.displayType === 'return') {
    return {
      icon: RotateCcw,
      label: 'Devolución',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      tooltip: ['Operación de retiro o devolución', `Pedido: ${row.primaryOrder.order_number}`],
    };
  }

  return {
    icon: ShoppingBag,
    label: 'Entrega',
    className: 'border-gray-200 bg-gray-50 text-gray-700',
    tooltip: ['Pedido de entrega'],
  };
}

export default function Orders() {
  const { orders, loading, error, add, advance, reload } = useOrders();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [transporterFilter, setTransporterFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [helpLoading, setHelpLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [workloadHint, setWorkloadHint] = useState<WorkloadHint | null>(null);
  const [confirmPicking, setConfirmPicking] = useState<number | null>(null);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDispatchModal, setShowDispatchModal] = useState(false);

  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchTransporterId, setDispatchTransporterId] = useState<number | null>(null);
  const [dispatchTransporters, setDispatchTransporters] = useState<Transporter[]>([]);
  const [dispatchTransporterSearch, setDispatchTransporterSearch] = useState('');
  const [showDispatchTransporterDropdown, setShowDispatchTransporterDropdown] = useState(false);
  const [pendingLabelLoading, setPendingLabelLoading] = useState(false);
  const [printingOrderId, setPrintingOrderId] = useState<number | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [previewBatchSession, setPreviewBatchSession] = useState<BatchPickingSession | null>(null);

  // Search & client filter
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(value), 300);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  useEffect(() => {
    fetchTransporters(true).then(setDispatchTransporters).catch(() => {});
  }, []);

  useEffect(() => {
    fetchActiveBatchPickingSession()
      .then((session) => setPreviewBatchSession(session))
      .catch(() => setPreviewBatchSession(null));
  }, []);

  // Workload hint polling (operator only)
  const isOperator = user?.role === 'operator';
  useEffect(() => {
    if (!isOperator) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const hint = await fetchWorkloadHint();
        if (!cancelled) setWorkloadHint(hint);
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 8_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isOperator]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;

    // Text search
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((o) => {
        const fields = [
          o.order_number,
          o.client_name,
          o.buyer_name,
          o.buyer_address,
          o.address_line,
          o.city,
          o.state,
          o.postal_code,
          o.cordon,
          o.shipping_status,
          o.shipping_id,
          o.external_id,
          o.ml_item_id,
          o.variation_id,
          o.mapping_status,
          o.source,
          o.assigned_operator_name,
          ...o.items.map((i) => i.sku),
        ];
        return fields.some((f) => f && f.toLowerCase().includes(q));
      });
    }

    // Date range
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      result = result.filter((o) => new Date(o.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((o) => new Date(o.created_at) <= to);
    }

    // Transporter filter
    if (transporterFilter) {
      result = result.filter((o) => (o.dispatch_transporter_name || o.dispatch_carrier || '') === transporterFilter);
    }

    return result;
  }, [orders, searchQuery, dateFrom, dateTo, transporterFilter]);

  const operationRows = useMemo(() => buildOperationRows(filteredOrders), [filteredOrders]);

  // Unique zones for filter dropdown
  const zoneOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) if (o.dominant_zone) set.add(o.dominant_zone);
    return Array.from(set).sort();
  }, [orders]);

  // Unique transporter names for filter dropdown
  const transporterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      const name = o.dispatch_transporter_name || o.dispatch_carrier;
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [orders]);

  // Detect if search matches an operator name → show chip
  const matchedOperator = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const operators = new Map<string, string>();
    for (const o of orders) {
      if (o.assigned_operator_name) operators.set(o.assigned_operator_name.toLowerCase(), o.assigned_operator_name);
    }
    for (const [key, name] of operators) {
      if (key.includes(q)) return name;
    }
    return null;
  }, [orders, searchQuery]);

  useEffect(() => {
    fetchStock().then(setStockItems).catch(() => {});
  }, [orders]);

  useEffect(() => {
    if (!isCreatingOrder) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [isCreatingOrder]);

  const openDispatchModal = (ids?: number[]) => {
    if (ids) {
      setSelected(new Set(ids));
    }
    setShowDispatchModal(true);
  };

  const closeDispatchModal = () => {
    setShowDispatchModal(false);
    setDispatchNotes('');
    setDispatchTransporterId(null);
    setDispatchTransporterSearch('');
    setShowDispatchTransporterDropdown(false);
    setActionError('');
  };

  const selectedDispatchTransporter = useMemo(
    () => dispatchTransporters.find((t) => t.id === dispatchTransporterId) ?? null,
    [dispatchTransporters, dispatchTransporterId],
  );

  const filteredDispatchTransporters = useMemo(() => {
    const q = dispatchTransporterSearch.trim().toLowerCase();
    if (!q) return dispatchTransporters;
    return dispatchTransporters.filter((t) => t.name.toLowerCase().includes(q));
  }, [dispatchTransporters, dispatchTransporterSearch]);

  const handleDispatch = async () => {
    setDispatchLoading(true);
    setActionError('');
    try {
      const result = await batchDispatch({
        order_ids: Array.from(selected),
        carrier: selectedDispatchTransporter?.name || dispatchTransporterSearch.trim() || undefined,
        transporter_id: dispatchTransporterId ?? undefined,
        notes: dispatchNotes || undefined,
      });
      reload(statusFilter || undefined, zoneFilter || undefined);
      setSelected(new Set());
      closeDispatchModal();
      setSuccessMsg(`✔ Lote ${result.batch_number} creado con ${result.order_count} pedido${result.order_count !== 1 ? 's' : ''}${result.carrier ? ` · ${result.carrier}` : ''}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al despachar';
      setActionError(msg);
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleStartPicking = async (id: number) => {
    setActionError('');
    setActionLoading(id);
    try {
      await advance(id);
      setConfirmPicking(null);
      navigate(`/picking/${id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al iniciar picking';
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleHelpZone = async () => {
    setHelpLoading(true);
    setActionError('');
    try {
      const result = await helpOtherZone();
      setSuccessMsg(result.message);
      if (result.assigned > 0) {
        reload(statusFilter || undefined, zoneFilter || undefined);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al buscar pedidos';
      setActionError(msg);
    } finally {
      setHelpLoading(false);
    }
  };

  const stockByProduct = useMemo(() => {
    const map = new Map<number, { reserved: number; available: number }>();
    for (const s of stockItems) {
      const prev = map.get(s.product_id) ?? { reserved: 0, available: 0 };
      map.set(s.product_id, {
        reserved: prev.reserved + s.quantity_reserved,
        available: prev.available + s.quantity_available,
      });
    }
    return map;
  }, [stockItems]);

  const dispatchableOperations = useMemo(
    () => operationRows.filter((row) => isDispatchableOperation(row)),
    [operationRows],
  );
  const selectedOperationRows = useMemo(
    () => operationRows.filter((row) => row.orderIds.some((id) => selected.has(id))),
    [operationRows, selected],
  );
  const selectedOperationCount = selectedOperationRows.length;
  const preparedOrders = useMemo(
    () => filteredOrders.filter((o) => o.status === 'prepared' && o.operation_type === 'sale'),
    [filteredOrders],
  );
  const pendingLabelOrders = useMemo(
    () => preparedOrders.filter((o) => Boolean(o.shipping_id) && !o.label_printed),
    [preparedOrders],
  );

  const toggleSelectOperation = (orderIds: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = orderIds.every((orderId) => next.has(orderId));
      if (allSelected) {
        orderIds.forEach((orderId) => next.delete(orderId));
      } else {
        orderIds.forEach((orderId) => next.add(orderId));
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const dispatchableIds = dispatchableOperations.flatMap((row) => row.orderIds);
    const allSelected = dispatchableIds.length > 0 && dispatchableIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(dispatchableIds));
    }
  };

  const handleOpenBatchPicking = async () => {
    setBatchLoading(true);
    setActionError('');
    try {
      const session = previewBatchSession ?? await startBatchPickingSession();
      setPreviewBatchSession(session);
      navigate(`/picking/batch/${session.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo iniciar el picking masivo';
      setActionError(msg);
    } finally {
      setBatchLoading(false);
    }
  };

  const handlePrintPendingLabels = async () => {
    setPendingLabelLoading(true);
    setActionError('');
    try {
      const result = await printPendingLabels();
      reload(statusFilter || undefined, zoneFilter || undefined);
      const warning = result.failedCount > 0 ? ` ${result.failedCount} etiqueta${result.failedCount !== 1 ? 's' : ''} no se pudieron generar.` : '';
      setSuccessMsg(`Se generaron ${result.generatedCount} etiqueta${result.generatedCount !== 1 ? 's' : ''}.${warning}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudieron imprimir las etiquetas pendientes';
      setActionError(msg);
    } finally {
      setPendingLabelLoading(false);
    }
  };

  const handlePrintOrderLabel = async (order: Order) => {
    if (order.label_generated) {
      const confirmed = window.confirm(`Esta etiqueta ya fue impresa ${order.label_print_count} veces. ¿Deseás continuar?`);
      if (!confirmed) return;
    }

    setPrintingOrderId(order.id);
    setActionError('');
    try {
      const result = await printOrderLabel(order.id);
      reload(statusFilter || undefined, zoneFilter || undefined);
      const warning = result.failedCount > 0 ? ` ${result.failedCount} falló/fallaron.` : '';
      setSuccessMsg(`Se generó ${result.generatedCount} etiqueta para ${order.order_number}.${warning}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo imprimir la etiqueta';
      setActionError(msg);
    } finally {
      setPrintingOrderId(null);
    }
  };

  const handleGenerateManualLabel = async (order: Order) => {
    if (order.label_generated && order.label_type === 'manual') {
      const confirmed = window.confirm('Esta etiqueta manual ya fue generada anteriormente. ¿Deseás reimprimirla?');
      if (!confirmed) return;
    }

    setPrintingOrderId(order.id);
    setActionError('');
    try {
      await generateManualLabel(order.id);
      reload(statusFilter || undefined, zoneFilter || undefined);
      setSuccessMsg(`Se generó la etiqueta manual para ${order.order_number}.`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo generar la etiqueta manual';
      setActionError(msg);
    } finally {
      setPrintingOrderId(null);
    }
  };



  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isCreatingOrder ? 'Nuevo pedido' : 'Pedidos'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {isCreatingOrder
              ? 'Carga de un nuevo pedido'
              : 'Gestión de pedidos y flujo de estados'}
          </p>
        </div>
        {!isCreatingOrder && (
          <div className="flex items-center gap-3">
            {isOperator && (
              <button
                onClick={handleOpenBatchPicking}
                disabled={batchLoading}
                className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {batchLoading ? 'Agrupando...' : 'Iniciar picking masivo'}
              </button>
            )}
            {isOperator && (
              <button
                onClick={handleHelpZone}
                disabled={helpLoading}
                className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {helpLoading ? 'Buscando...' : '🤝 Ayudar en otra zona'}
              </button>
            )}
            <button
              onClick={() => setIsCreatingOrder(true)}
              className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
            >
              + Nuevo pedido
            </button>
            <button
              onClick={() => openDispatchModal()}
              disabled={selected.size === 0}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🚚 Despachar{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            <button
              onClick={handlePrintPendingLabels}
              disabled={pendingLabelLoading || pendingLabelOrders.length === 0}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pendingLabelLoading
                ? 'Generando etiquetas...'
                : `Imprimir etiquetas pendientes${pendingLabelOrders.length > 0 ? ` (${pendingLabelOrders.length})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* Operator availability banner */}
      {!isCreatingOrder && isOperator && workloadHint?.message && (
        <div className="mb-4 flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">💡</span>
            <p className="text-sm font-medium text-yellow-800">{workloadHint.message}</p>
          </div>
          <button
            onClick={handleHelpZone}
            disabled={helpLoading}
            className="bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {helpLoading ? 'Asignando...' : 'Ayudar ahora'}
          </button>
        </div>
      )}

      {!isCreatingOrder && (
        <>
      {/* Search & Filters bar */}
      <div className="flex items-center gap-3 mb-4">
        {/* Global search */}
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar pedido, cliente, dirección, operario..."
            className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setSearchQuery(''); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-500 text-sm"
            >✕</button>
          )}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            reload(e.target.value || undefined, zoneFilter || undefined);
          }}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[170px]"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Zone filter */}
        {zoneOptions.length > 0 && (
          <select
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value);
              reload(statusFilter || undefined, e.target.value || undefined);
            }}
            className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[140px]"
          >
            <option value="">Todas las zonas</option>
            {zoneOptions.map((z) => (
              <option key={z} value={z}>Zona {z}</option>
            ))}
          </select>
        )}

        {/* Transporter filter */}
        {transporterOptions.length > 0 && (
          <select
            value={transporterFilter}
            onChange={(e) => setTransporterFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[170px]"
          >
            <option value="">Todos los transportistas</option>
            {transporterOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <span className="text-gray-500 text-xs">a</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-gray-500 hover:text-gray-500 text-sm ml-0.5"
            >✕</button>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      {matchedOperator && (
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-1 text-sm font-medium">
            Operario: {matchedOperator}
            <button
              onClick={() => { setSearchInput(''); setSearchQuery(''); }}
              className="text-blue-700 hover:text-blue-700 ml-0.5"
            >✕</button>
          </span>
        </div>
      )}

        </>
      )}

      {!isCreatingOrder && (error || actionError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          {error || actionError}
        </div>
      )}

      {isCreatingOrder ? (
        <CreateOrderForm
          onCreated={(order) => {
            setIsCreatingOrder(false);
            setSuccessMsg(`Pedido #${order.id} creado (${order.order_number})`);
          }}
          onCancel={() => setIsCreatingOrder(false)}
          addOrder={add}
        />
      ) : loading ? (
        <div className="text-center py-12 text-gray-500">Cargando pedidos...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">No hay pedidos</p>
          <p className="text-gray-500 text-sm">Creá tu primer pedido con el botón de arriba.</p>
        </div>
      ) : operationRows.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">Sin resultados</p>
          <p className="text-gray-500 text-sm">Probá con otra búsqueda o ajustá los filtros.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0 table-scroll-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={dispatchableOperations.length > 0 && dispatchableOperations.every((row) => row.orderIds.every((id) => selected.has(id)))}
                    onChange={toggleSelectAll}
                    disabled={dispatchableOperations.length === 0}
                    className="rounded border-gray-200 text-green-700 focus:ring-blue-500 disabled:opacity-30"
                    title="Seleccionar todos los listos para despacho"
                  />
                </th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Nº Pedido</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Productos</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Zona</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Envío</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estado</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Despacho</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Fecha</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {operationRows.map((row) => {
                const primaryOrder = row.primaryOrder;
                const deliveryOrder = row.deliveryOrder;
                const returnOrder = row.returnOrder;
                const operationIndicator = getOperationIndicator(row);
                const OperationIcon = operationIndicator.icon;
                const mainStatus = getRowMainStatus(row);
                const statusDetails = getRowStatusDetails(row);
                const shippingSummary = getShippingSummary(deliveryOrder);
                const canSelect = isDispatchableOperation(row);
                const isSelected = row.orderIds.every((id) => selected.has(id));
                const canPrintExternalLabel = Boolean(deliveryOrder?.shipping_id) && deliveryOrder?.status !== 'cancelled';
                const canPrintManualLabel = Boolean(
                  deliveryOrder
                  && deliveryOrder.source === 'manual'
                  && deliveryOrder.operation_type === 'sale'
                  && deliveryOrder.status !== 'cancelled'
                  && (deliveryOrder.address_line || deliveryOrder.buyer_address)
                  && (deliveryOrder.city || deliveryOrder.state || deliveryOrder.postal_code),
                );
                const labelStatus = canPrintExternalLabel
                  ? deliveryOrder?.label_generated
                    ? { text: LABEL_TYPE_LABELS[deliveryOrder.label_type ?? 'external'] ?? 'Etiqueta generada', className: 'bg-green-50 text-green-700' }
                    : { text: 'Pendiente de impresion', className: 'bg-yellow-50 text-yellow-800' }
                  : canPrintManualLabel
                    ? deliveryOrder?.label_generated && deliveryOrder?.label_type === 'manual'
                      ? { text: 'Etiqueta manual generada', className: 'bg-green-50 text-green-700' }
                      : { text: 'Etiqueta manual pendiente', className: 'bg-yellow-50 text-yellow-800' }
                    : { text: 'Sin etiqueta disponible', className: 'bg-gray-50 text-gray-500' };
                const dispatchSummary = getDispatchSummary(primaryOrder, deliveryOrder, labelStatus);
                return (
                  <tr
                    key={row.key}
                    className={`border-b border-gray-200 hover:bg-gray-50 ${primaryOrder.status === 'cancelled' ? 'opacity-50' : ''} ${isSelected ? 'bg-green-50/50' : ''}`}
                  >
                    <td className="px-3 py-4 text-center">
                      {canSelect ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOperation(row.orderIds)}
                          className="rounded border-gray-200 text-green-700 focus:ring-blue-500"
                        />
                      ) : (
                        <input type="checkbox" disabled className="rounded border-gray-200 opacity-20" />
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${operationIndicator.className}`}>
                          <OperationIcon size={15} strokeWidth={2.1} />
                        </div>
                        <div className="min-w-0">
                          <button
                            onClick={() => navigate(`/orders/${primaryOrder.id}`)}
                            className="font-medium text-blue-700 hover:text-blue-700 hover:underline"
                          >
                            {primaryOrder.order_number}
                          </button>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[11px] text-gray-500">{operationIndicator.label}</span>
                            <InfoTooltip content={operationIndicator.tooltip} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        to={`/clients/${primaryOrder.client_id}`}
                        className="text-gray-900 hover:text-blue-700 hover:underline transition"
                      >
                        {primaryOrder.client_name ?? `#${primaryOrder.client_id}`}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      <div className="flex flex-col gap-1">
                        {deliveryOrder && (
                          <span>
                            Entrega: {deliveryOrder.items.map((item) => `${item.sku} x${item.quantity}`).join(' · ')}
                          </span>
                        )}
                        {returnOrder && (
                          <span>
                            Retiro: {returnOrder.items.map((item) => `${item.sku} x${item.quantity}`).join(' · ')}
                          </span>
                        )}
                        {!returnOrder && !deliveryOrder && (
                          <span>
                            {primaryOrder.items.length} producto{primaryOrder.items.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {primaryOrder.ml_item_id && (
                          <span className="text-[11px] text-gray-500">
                            ML: {primaryOrder.ml_item_id}
                            {primaryOrder.variation_id ? ` / Var: ${primaryOrder.variation_id}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {deliveryOrder?.dominant_zone ? (
                        <span className="bg-yellow-50 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium">
                          {deliveryOrder.dominant_zone}
                        </span>
                      ) : (
                        <span className="text-border text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="text-gray-900 font-semibold">{shippingSummary.primary}</div>
                        <InfoTooltip content={shippingSummary.details} />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium w-fit ${mainStatus.className}`}>
                          {mainStatus.label}
                        </span>
                        <InfoTooltip content={statusDetails} />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs">
                      {dispatchSummary.primary !== '—' || dispatchSummary.details.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="text-gray-900 font-medium">{dispatchSummary.primary}</div>
                          <InfoTooltip content={dispatchSummary.details} />
                        </div>
                      ) : (
                        <span className="text-border">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {new Date(primaryOrder.created_at).toLocaleDateString('es-AR')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => navigate(`/orders/${primaryOrder.id}`)}
                          className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                        >
                          Ver
                        </button>
                        {deliveryOrder?.status === 'pending' && deliveryOrder.mapping_status !== 'unmapped' && (
                          <button
                            onClick={() => setConfirmPicking(deliveryOrder.id)}
                            className="ui-btn-primary px-3 py-1.5 text-xs font-medium rounded-lg"
                          >
                            📦 Iniciar picking
                          </button>
                        )}
                        {deliveryOrder?.status === 'pending' && deliveryOrder.mapping_status === 'unmapped' && (
                          <button
                            onClick={() => navigate('/integrations/ml/mappings')}
                            className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-50 transition"
                          >
                            Resolver mapping
                          </button>
                        )}
                        {deliveryOrder?.status === 'in_preparation' && (
                          <button
                            onClick={() => navigate(`/picking/${deliveryOrder.id}`)}
                            className="ui-btn-primary px-3 py-1.5 text-xs font-medium rounded-lg"
                          >
                            📦 Continuar picking
                          </button>
                        )}
                        {canSelect && (
                          <button
                            onClick={() => openDispatchModal(row.orderIds)}
                            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-50 transition"
                          >
                            🚚 Despachar
                          </button>
                        )}
                        {canPrintExternalLabel && (
                          <button
                            onClick={() => deliveryOrder && handlePrintOrderLabel(deliveryOrder)}
                            disabled={printingOrderId === deliveryOrder?.id}
                            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-50 transition disabled:opacity-50"
                          >
                            {printingOrderId === deliveryOrder?.id
                              ? 'Generando...'
                              : deliveryOrder?.label_generated
                                ? 'Reimprimir etiqueta'
                                : 'Imprimir etiqueta'}
                          </button>
                        )}
                        {!canPrintExternalLabel && canPrintManualLabel && (
                          <button
                            onClick={() => deliveryOrder && handleGenerateManualLabel(deliveryOrder)}
                            disabled={printingOrderId === deliveryOrder?.id}
                            className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-50 transition disabled:opacity-50"
                          >
                            {printingOrderId === deliveryOrder?.id
                              ? 'Generando...'
                              : deliveryOrder?.label_generated && deliveryOrder?.label_type === 'manual'
                                ? 'Reimprimir etiqueta'
                                : 'Imprimir etiqueta'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Floating selection bar */}
      {selected.size > 0 && !showDispatchModal && !isCreatingOrder && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-text-blue-700 text-white rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4 z-40">
          <span className="text-sm font-medium">
            {selectedOperationCount} operación{selectedOperationCount !== 1 ? 'es' : ''} seleccionada{selectedOperationCount !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => openDispatchModal()}
            className="bg-green-600 hover:bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition"
          >
            🚚 Despachar selección
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-gray-500 hover:text-white text-sm transition"
          >
            Limpiar
          </button>
        </div>
      )}

      {!isCreatingOrder && successMsg && <SuccessToast message={successMsg} onClose={() => setSuccessMsg('')} duration={5000} />}


      {/* Unified dispatch modal */}
      {showDispatchModal && (() => {
        const invalidRows = selectedOperationRows.filter((row) => !isDispatchableOperation(row));
        const validRows = selectedOperationRows.filter((row) => isDispatchableOperation(row));
        const totalUnits = validRows.reduce(
          (sum, row) => sum + row.orderIds.reduce((orderSum, id) => {
            const order = orders.find((candidate) => candidate.id === id);
            return orderSum + (order?.items.reduce((itemSum, item) => itemSum + item.quantity, 0) ?? 0);
          }, 0),
          0,
        );
        return (
          <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-1">🚚 Crear traslado a transporte</h3>
              <p className="text-sm text-gray-500 mb-4">
                {validRows.length === 1
                  ? <>Vas a crear <strong>1</strong> despacho con 1 operación ({totalUnits} unidad{totalUnits !== 1 ? 'es' : ''}).</>
                  : <>Vas a crear un despacho con <strong>{validRows.length}</strong> operaciones ({totalUnits} unidades).</>
                }
                {' '}Se creará un lote automáticamente para el despacho seleccionado.
              </p>

              {invalidRows.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-3 mb-4">
                  ⚠ {invalidRows.length} operación{invalidRows.length !== 1 ? 'es' : ''} no está{invalidRows.length !== 1 ? 'n' : ''} lista{invalidRows.length !== 1 ? 's' : ''} para despacho y será{invalidRows.length !== 1 ? 'n' : ''} excluida{invalidRows.length !== 1 ? 's' : ''}.
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto space-y-1.5">
                {validRows.map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-gray-900">{OPERATION_LABELS[row.displayType]}</span>
                      <span className="font-mono text-xs text-gray-500">{row.primaryOrder.order_number}</span>
                      {row.returnOrder && <span className="font-mono text-xs text-gray-500">Retiro: {row.returnOrder.order_number}</span>}
                    </div>
                    <span className="text-gray-500 text-xs">{row.primaryOrder.client_name ?? `#${row.primaryOrder.client_id}`}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-3 mb-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Transportista
                  </label>
                  {selectedDispatchTransporter ? (
                    <div className="flex items-center gap-2 px-3 py-2 border border-green-200 bg-green-50 rounded-lg">
                      <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">🚚 {selectedDispatchTransporter.name}</span>
                      <button
                        onClick={() => { setDispatchTransporterId(null); setDispatchTransporterSearch(''); }}
                        className="ml-auto text-gray-500 hover:text-red-700 text-sm"
                      >✕</button>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        value={dispatchTransporterSearch}
                        onChange={(e) => { setDispatchTransporterSearch(e.target.value); setShowDispatchTransporterDropdown(true); }}
                        onFocus={() => setShowDispatchTransporterDropdown(true)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        placeholder="Buscar o escribir transportista..."
                        autoComplete="off"
                      />
                      {showDispatchTransporterDropdown && filteredDispatchTransporters.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredDispatchTransporters.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setDispatchTransporterId(t.id);
                                setDispatchTransporterSearch('');
                                setShowDispatchTransporterDropdown(false);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center gap-2"
                            >
                              <span className="font-medium text-gray-900">{t.name}</span>
                              {t.zone && <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{t.zone}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Observaciones <span className="text-gray-500 font-normal">(opcional)</span>
                  </label>
                  <textarea
                    value={dispatchNotes}
                    onChange={(e) => setDispatchNotes(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                    placeholder="Notas adicionales..."
                  />
                </div>
              </div>

              {actionError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{actionError}</div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={closeDispatchModal}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDispatch}
                  disabled={dispatchLoading || validRows.length === 0}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 bg-green-600 hover:opacity-90 text-white"
                >
                  {dispatchLoading ? 'Creando despacho...' : `🚚 Crear despacho (${validRows.length})`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Confirm picking modal */}
      {confirmPicking && (() => {
        const order = orders.find((o) => o.id === confirmPicking);
        if (!order) return null;
        const hasStockIssue = order.items.some((item) => {
          const stock = stockByProduct.get(item.product_id);
          return !stock || stock.reserved < item.quantity;
        });
        return (
          <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-1">Iniciar picking</h3>
              <p className="text-sm text-gray-500 mb-4">
                Pedido {order.order_number} · {order.client_name ?? `#${order.client_id}`}
              </p>

              <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-2">
                {order.items.map((item) => {
                  const stock = stockByProduct.get(item.product_id);
                  const reserved = stock?.reserved ?? 0;
                  const ok = reserved >= item.quantity;
                  return (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded font-mono text-xs">{item.sku}</span>
                        <span className="text-gray-900">×{item.quantity}</span>
                      </div>
                      <div className={`text-xs font-medium ${ok ? 'text-green-700' : 'text-red-700'}`}>
                        {ok ? `Reservado: ${reserved}` : `Reservado: ${reserved} (insuficiente)`}
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasStockIssue && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
                  No hay suficiente stock reservado para iniciar el picking.
                </div>
              )}

              {actionError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{actionError}</div>
              )}

              <p className="text-xs text-gray-500 mb-4">
                Al confirmar, el pedido pasará a "Preparando pedido" y se registrará la fecha y el usuario.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => { setConfirmPicking(null); setActionError(''); }}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
                >
                  Volver
                </button>
                <button
                  onClick={() => handleStartPicking(confirmPicking)}
                  disabled={actionLoading === confirmPicking || hasStockIssue}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {actionLoading === confirmPicking ? 'Procesando...' : '📦 Confirmar e iniciar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

/* ─── Create Order Form ─── */
function CreateOrderForm({
  onCreated, onCancel, addOrder,
}: {
  onCreated: (order: { id: number; order_number: string }) => void;
  onCancel: () => void;
  addOrder: (p: OrderCreatePayload) => Promise<{ id: number; order_number: string }>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [orderMode, setOrderMode] = useState<'manual' | 'mercadolibre'>('manual');
  const [operationType, setOperationType] = useState<'sale' | 'return' | 'exchange'>('sale');
  const [clientId, setClientId] = useState('');
  const [items, setItems] = useState<{ product_id: string; quantity: string }[]>([
    { product_id: '', quantity: '1' },
  ]);
  const [returnItems, setReturnItems] = useState<{ product_id: string; quantity: string }[]>([
    { product_id: '', quantity: '1' },
  ]);
  const [externalId, setExternalId] = useState('');
  const [mlItemId, setMlItemId] = useState('');
  const [variationId, setVariationId] = useState('');
  const [requestedQuantity, setRequestedQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [addressReference, setAddressReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetchClients().then((c) => setClients(c.filter((cl) => cl.is_active))).catch(() => {});
    fetchProducts().then((p) => setProducts(p.filter((pr) => pr.is_active))).catch(() => {});
    fetchStock().then(setStockItems).catch(() => {});
  }, []);

  const stockByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of stockItems) {
      map.set(s.product_id, (map.get(s.product_id) ?? 0) + s.quantity_available);
    }
    return map;
  }, [stockItems]);

  const clientProducts = clientId
    ? products.filter((p) => p.client_id === parseInt(clientId))
    : [];

  const isMarketplaceMode = orderMode === 'mercadolibre';

  const addItem = () => setItems((prev) => [...prev, { product_id: '', quantity: '1' }]);
  const addReturnItem = () => setReturnItems((prev) => [...prev, { product_id: '', quantity: '1' }]);

  const removeItem = (idx: number) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, i) => i !== idx));
    }
  };

  const removeReturnItem = (idx: number) => {
    if (returnItems.length > 1) {
      setReturnItems((prev) => prev.filter((_, i) => i !== idx));
    }
  };

  const updateItem = (idx: number, field: 'product_id' | 'quantity', value: string) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const updateReturnItem = (idx: number, field: 'product_id' | 'quantity', value: string) => {
    setReturnItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientId) { setFormError('Seleccioná un cliente'); return; }

    let parsedItems: { product_id: number; quantity: number }[] = [];
    let parsedReturnItems: { product_id: number; quantity: number }[] = [];
    if (isMarketplaceMode) {
      if (!mlItemId.trim()) { setFormError('Ingresá el item_id de MercadoLibre'); return; }
      const parsedQuantity = parseInt(requestedQuantity);
      if (!parsedQuantity || parsedQuantity <= 0) { setFormError('Ingresá una cantidad válida'); return; }
    } else {
      parsedItems = items
        .filter((i) => i.product_id && parseInt(i.quantity) > 0)
        .map((i) => ({ product_id: parseInt(i.product_id), quantity: parseInt(i.quantity) }));

      if (parsedItems.length === 0) { setFormError('Agregá al menos un producto'); return; }

      if (operationType === 'exchange') {
        parsedReturnItems = returnItems
          .filter((item) => item.product_id && parseInt(item.quantity) > 0)
          .map((item) => ({ product_id: parseInt(item.product_id), quantity: parseInt(item.quantity) }));

        if (parsedReturnItems.length === 0) {
          setFormError('Agregá al menos un producto a retirar');
          return;
        }
      }

      if (operationType === 'return') {
        parsedReturnItems = parsedItems;
        parsedItems = [];
      }

      for (const pi of parsedItems) {
        const avail = stockByProduct.get(pi.product_id) ?? 0;
        if (pi.quantity > avail) {
          const prod = products.find((p) => p.id === pi.product_id);
          setFormError(`Stock insuficiente para "${prod?.name ?? 'producto'}" (disponible: ${avail}, solicitado: ${pi.quantity})`);
          return;
        }
      }
    }

    setSaving(true);
    setFormError('');
    try {
      const order = await addOrder({
        client_id: parseInt(clientId),
        operation_type: isMarketplaceMode ? 'sale' : operationType,
        items: isMarketplaceMode ? [] : operationType === 'exchange' ? [] : operationType === 'return' ? parsedReturnItems : parsedItems,
        delivery_items: !isMarketplaceMode && operationType === 'exchange' ? parsedItems : undefined,
        return_items: !isMarketplaceMode && operationType === 'exchange' ? parsedReturnItems : undefined,
        source: isMarketplaceMode ? 'mercadolibre' : 'manual',
        external_id: externalId || undefined,
        ml_item_id: isMarketplaceMode ? mlItemId || undefined : undefined,
        variation_id: isMarketplaceMode ? variationId || undefined : undefined,
        quantity: isMarketplaceMode ? parseInt(requestedQuantity) : undefined,
        zip_code: postalCode || undefined,
        buyer_name: buyerName || undefined,
        address_line: addressLine || undefined,
        city: city || undefined,
        state: state || undefined,
        postal_code: postalCode || undefined,
        address_reference: addressReference || undefined,
        notes: notes || undefined,
      });
      onCreated(order);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al crear pedido';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Nuevo pedido</h2>
      <p className="text-sm text-gray-500 mb-4">
        Al guardar, el sistema intenta asignar cordón y costo de envío automáticamente según código postal y categoría de peso.
      </p>

      <div className="grid grid-cols-1 gap-3 mb-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setOrderMode('manual')}
          className={`rounded-xl border px-4 py-3 text-left transition ${
            !isMarketplaceMode ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-200'
          }`}
        >
          <div className="text-sm font-semibold">Pedido manual</div>
          <div className="mt-1 text-xs">Selección directa de SKU interno con validación de stock antes de guardar.</div>
        </button>
        <button
          type="button"
          onClick={() => setOrderMode('mercadolibre')}
          className={`rounded-xl border px-4 py-3 text-left transition ${
            isMarketplaceMode ? 'border-yellow-200 bg-yellow-50 text-yellow-800' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-200'
          }`}
        >
          <div className="text-sm font-semibold">Simular MercadoLibre</div>
          <div className="mt-1 text-xs">Alta por item_id externo. Si no existe mapping, el pedido queda pendiente para resolución.</div>
        </button>
      </div>

      {!isMarketplaceMode && (
        <div className="grid grid-cols-1 gap-3 mb-4 sm:grid-cols-3">
          {(['sale', 'return', 'exchange'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setOperationType(value)}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                operationType === value ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-200'
              }`}
            >
              <div className="text-sm font-semibold">{OPERATION_LABELS[value]}</div>
              <div className="mt-1 text-xs">
                {value === 'sale' && 'Entrega normal con reserva y descuento de stock.'}
                {value === 'return' && 'Solo retiro del cliente, sin reserva de stock.'}
                {value === 'exchange' && 'Entrega + retiro vinculados en una sola logística inversa.'}
              </div>
            </button>
          ))}
        </div>
      )}

      {formError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{formError}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Client */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">Cliente</label>
          <select
            required
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setItems([{ product_id: '', quantity: '1' }]);
              setReturnItems([{ product_id: '', quantity: '1' }]);
            }}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="">Seleccionar cliente...</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {isMarketplaceMode && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-yellow-200 bg-yellow-50/60 p-4 md:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">ID externo del pedido</label>
              <input
                type="text"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                className="w-full px-4 py-2.5 border border-yellow-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-yellow-200 outline-none"
                placeholder="2000001234567890"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Item ID ML</label>
              <input
                type="text"
                required={isMarketplaceMode}
                value={mlItemId}
                onChange={(e) => setMlItemId(e.target.value)}
                className="w-full px-4 py-2.5 border border-yellow-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-yellow-200 outline-none"
                placeholder="MLA123456789"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Variation ID</label>
              <input
                type="text"
                value={variationId}
                onChange={(e) => setVariationId(e.target.value)}
                className="w-full px-4 py-2.5 border border-yellow-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-yellow-200 outline-none"
                placeholder="Opcional"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cantidad solicitada</label>
              <input
                type="number"
                min={1}
                required={isMarketplaceMode}
                value={requestedQuantity}
                onChange={(e) => setRequestedQuantity(e.target.value)}
                className="w-full px-4 py-2.5 border border-yellow-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-yellow-200 outline-none"
              />
            </div>
          </div>
        )}

        {!isMarketplaceMode && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-900">{operationType === 'return' ? 'Productos a retirar' : 'Productos a entregar'}</label>
            <button
              type="button"
              onClick={addItem}
              className="text-xs text-blue-700 hover:text-blue-700 font-medium"
            >
              + Agregar producto
            </button>
          </div>

          <div className="space-y-2">
            {items.map((item, idx) => {
              const prodId = item.product_id ? parseInt(item.product_id) : null;
              const avail = prodId ? (stockByProduct.get(prodId) ?? 0) : null;
              const qty = parseInt(item.quantity);
              const exceeds = avail !== null && !isNaN(qty) && qty > avail;
              return (
              <div key={idx}>
                <div className="flex gap-2 items-center">
                  <select
                    required
                    value={item.product_id}
                    onChange={(e) => updateItem(idx, 'product_id', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">Producto...</option>
                    {clientProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    required
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                    className={`w-20 px-3 py-2 border rounded-lg text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none ${
                      exceeds ? 'border-red-200 bg-red-50' : 'border-gray-200'
                    }`}
                    placeholder="Cant."
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-red-700 hover:text-red-700 text-lg px-1"
                    >
                      &times;
                    </button>
                  )}
                </div>
                {avail !== null && (
                  <p className={`text-xs mt-1 ml-1 ${exceeds ? 'text-red-700' : 'text-gray-500'}`}>
                    Disponible: {avail}{exceeds ? ' — stock insuficiente' : ''}
                  </p>
                )}
              </div>
              );
            })}
          </div>
        </div>
        )}

        {!isMarketplaceMode && operationType === 'exchange' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-900">Productos a retirar</label>
              <button
                type="button"
                onClick={addReturnItem}
                className="text-xs text-blue-700 hover:text-blue-700 font-medium"
              >
                + Agregar producto
              </button>
            </div>

            <div className="space-y-2">
              {returnItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select
                    required
                    value={item.product_id}
                    onChange={(e) => updateReturnItem(idx, 'product_id', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">Producto...</option>
                    {clientProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    required
                    value={item.quantity}
                    onChange={(e) => updateReturnItem(idx, 'quantity', e.target.value)}
                    className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Cant."
                  />
                  {returnItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeReturnItem(idx)}
                      className="text-red-700 hover:text-red-700 text-lg px-1"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dirección de envío */}
        <div className="border-t border-gray-200 pt-4">
          <label className="block text-sm font-medium text-gray-900 mb-3">Dirección de envío</label>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nombre del comprador</label>
              <input
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Juan Pérez"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Dirección</label>
              <input
                type="text"
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Av. Corrientes 1234, Piso 5"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Localidad</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="CABA"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Provincia</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Buenos Aires"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">C.P.</label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="1000"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Referencia <span className="text-gray-500">(opcional)</span></label>
              <input
                type="text"
                value={addressReference}
                onChange={(e) => setAddressReference(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Ej: entre calles, timbre, portería..."
              />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            Notas <span className="text-gray-500 font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            placeholder="Instrucciones especiales..."
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Creando...' : isMarketplaceMode ? 'Crear simulación ML' : operationType === 'exchange' ? 'Crear logística inversa' : 'Crear pedido'}
          </button>
        </div>
      </form>
    </div>
  );
}
