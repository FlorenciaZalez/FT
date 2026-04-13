import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  PackageCheck,
  RefreshCw,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { fetchAlerts } from '../services/alerts';
import type { Alert } from '../services/alerts';
import {
  getMLAuthUrl,
  disconnectMLAccount,
  getMLAccount,
  getApiErrorMessage,
  type MLAccount,
} from '../services/mercadolibre';
import { fetchOrders, fetchWorkloadStatus } from '../services/orders';
import type { Order, WorkloadStatus } from '../services/orders';
import { fetchStock, fetchStockMovements } from '../services/stock';
import type { StockItem, StockMovement } from '../services/stock';
import type { DashboardLayoutContext } from '../layouts/DashboardLayout';

const WORKLOAD_REFRESH_MS = 8_000;
const CLIENT_REFRESH_MS = 20_000;
const WEEKDAY_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

type ActivityTone = 'emerald' | 'blue' | 'amber';

type ClientActivityItem = {
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
  tone: ActivityTone;
  icon: LucideIcon;
};

type WeeklyBar = {
  key: string;
  label: string;
  value: number;
  isToday: boolean;
};

type ClientDashboardSnapshot = {
  stockAvailable: number;
  stockReserved: number;
  trackedProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  activeOrders: number;
  preparingOrders: number;
  readyOrders: number;
  dispatchedToday: number;
  returnsInProgress: number;
  openAlerts: number;
  weeklyBars: WeeklyBar[];
  activity: ClientActivityItem[];
  topProducts: Array<{
    productId: number;
    name: string;
    sku: string;
    available: number;
    reserved: number;
  }>;
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'pendiente',
  in_preparation: 'en preparación',
  prepared: 'listo para despacho',
  dispatched: 'despachado',
  cancelled: 'cancelado',
  awaiting_return: 'en devolución',
  returned_pending_review: 'devuelto pendiente de revisión',
};

const MOVEMENT_LABELS: Record<string, string> = {
  inbound: 'Ingreso',
  outbound: 'Salida',
  adjustment: 'Ajuste',
  reservation: 'Reserva',
  release: 'Liberación',
  return_inbound: 'Devolución',
  return_outbound: 'Retiro',
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(dateA: Date, dateB: Date): boolean {
  return dateA.getFullYear() === dateB.getFullYear()
    && dateA.getMonth() === dateB.getMonth()
    && dateA.getDate() === dateB.getDate();
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('es-AR').format(value);
}

function formatClock(date: Date | null): string {
  if (!date) return 'sin actualizar';
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'recién';

  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');

  return formatter.format(Math.round(hours / 24), 'day');
}

function getOrderTone(status: string): ActivityTone {
  if (status === 'dispatched') return 'emerald';
  if (status === 'pending' || status === 'in_preparation' || status === 'prepared') return 'blue';
  return 'amber';
}

function getMovementTone(movementType: string): ActivityTone {
  if (movementType === 'inbound' || movementType === 'return_inbound') return 'emerald';
  if (movementType === 'reservation' || movementType === 'adjustment') return 'blue';
  return 'amber';
}

function buildWeeklyBars(orders: Order[]): WeeklyBar[] {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label: WEEKDAY_LABELS[date.getDay()],
      value: 0,
      isToday: isSameDay(date, today),
    };
  });

  for (const order of orders) {
    const rawDate = order.dispatched_at ?? order.created_at;
    const eventDate = new Date(rawDate);
    if (Number.isNaN(eventDate.getTime())) continue;
    const bucket = days.find((item) => item.key === startOfDay(eventDate).toISOString().slice(0, 10));
    if (bucket) bucket.value += 1;
  }

  return days;
}

function buildActivity(orders: Order[], stockItems: StockItem[], movements: StockMovement[]): ClientActivityItem[] {
  const productMap = new Map(stockItems.map((item) => [item.product_id, item]));

  const movementEvents: ClientActivityItem[] = movements.slice(0, 8).map((movement) => {
    const product = productMap.get(movement.product_id);
    const quantity = Math.abs(movement.quantity);
    const movementLabel = MOVEMENT_LABELS[movement.movement_type] ?? 'Movimiento';
    const productLabel = product?.product_name ?? `Producto #${movement.product_id}`;
    const referenceLabel = movement.notes?.trim()
      ? movement.notes.trim()
      : movement.reference_type
        ? `${movement.reference_type.replace(/_/g, ' ')}${movement.reference_id ? ` #${movement.reference_id}` : ''}`
        : 'Actualización de inventario';

    return {
      id: `movement-${movement.id}`,
      title: `${movementLabel}: ${quantity} u. ${productLabel}`,
      subtitle: referenceLabel,
      createdAt: movement.created_at,
      tone: getMovementTone(movement.movement_type),
      icon: Boxes,
    };
  });

  const orderEvents: ClientActivityItem[] = orders.slice(0, 8).map((order) => {
    const statusLabel = ORDER_STATUS_LABELS[order.status] ?? order.status.replace(/_/g, ' ');
    const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
    const destination = order.city || order.state || order.buyer_name || 'sin destino';

    return {
      id: `order-${order.id}-${order.updated_at}`,
      title: `Pedido #${order.order_number} ${statusLabel}`,
      subtitle: `${itemCount} u. · ${destination}`,
      createdAt: order.updated_at,
      tone: getOrderTone(order.status),
      icon: Truck,
    };
  });

  return [...movementEvents, ...orderEvents]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 6);
}

function buildClientSnapshot(orders: Order[], stockItems: StockItem[], movements: StockMovement[], alerts: Alert[]): ClientDashboardSnapshot {
  const today = new Date();
  const stockAvailable = stockItems.reduce((total, item) => total + item.quantity_available, 0);
  const stockReserved = stockItems.reduce((total, item) => total + item.quantity_reserved, 0);
  const lowStockProducts = stockItems.filter(
    (item) => item.quantity_available > 0 && item.quantity_available <= item.min_stock_alert,
  ).length;
  const outOfStockProducts = stockItems.filter((item) => item.quantity_available <= 0).length;
  const activeOrders = orders.filter((order) => !['dispatched', 'cancelled'].includes(order.status)).length;
  const preparingOrders = orders.filter((order) => ['pending', 'in_preparation'].includes(order.status)).length;
  const readyOrders = orders.filter((order) => order.status === 'prepared').length;
  const dispatchedToday = orders.filter((order) => order.dispatched_at && isSameDay(new Date(order.dispatched_at), today)).length;
  const returnsInProgress = orders.filter((order) => ['awaiting_return', 'returned_pending_review'].includes(order.status)).length;

  return {
    stockAvailable,
    stockReserved,
    trackedProducts: stockItems.length,
    lowStockProducts,
    outOfStockProducts,
    activeOrders,
    preparingOrders,
    readyOrders,
    dispatchedToday,
    returnsInProgress,
    openAlerts: alerts.length,
    weeklyBars: buildWeeklyBars(orders),
    activity: buildActivity(orders, stockItems, movements),
    topProducts: [...stockItems]
      .sort((left, right) => right.quantity_available - left.quantity_available)
      .slice(0, 4)
      .map((item) => ({
        productId: item.product_id,
        name: item.product_name,
        sku: item.sku,
        available: item.quantity_available,
        reserved: item.quantity_reserved,
      })),
  };
}

function getToneClasses(tone: ActivityTone): string {
  if (tone === 'emerald') return 'bg-violet-50 text-[#7E00D5] ring-1 ring-[rgba(126,0,213,0.12)]';
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
  return 'bg-blue-50 text-blue-700 ring-1 ring-blue-100';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { visibleAlertNoticeCount, openAlertsPanel } = useOutletContext<DashboardLayoutContext>();
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  const [dispatchedToday, setDispatchedToday] = useState<number | null>(null);
  const [workload, setWorkload] = useState<WorkloadStatus | null>(null);
  const [mlAccount, setMlAccount] = useState<MLAccount | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlDisconnecting, setMlDisconnecting] = useState(false);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientSnapshot, setClientSnapshot] = useState<ClientDashboardSnapshot | null>(null);
  const [clientLastUpdatedAt, setClientLastUpdatedAt] = useState<Date | null>(null);
  const cancelledRef = useRef(false);
  const isAdmin = user?.role === 'admin';
  const isClient = user?.role === 'client';
  const clientId = user?.client_id ?? null;
  const pendingAlertNoticeCount = visibleAlertNoticeCount;

  useEffect(() => {
    if (isClient) return;

    cancelledRef.current = false;

    async function load() {
      try {
        const orders = await fetchOrders();
        if (cancelledRef.current) return;
        setPendingOrders(orders.filter((order) => order.status === 'pending').length);
        setDispatchedToday(
          orders.filter((order) => order.dispatched_at && isSameDay(new Date(order.dispatched_at), new Date())).length,
        );
      } catch {
        // silent
      }
    }

    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [isClient]);

  useEffect(() => {
    if (!isClient || !clientId) return;

    getMLAccount(clientId)
      .then(setMlAccount)
      .catch(() => setMlAccount(null));
  }, [isClient, clientId]);

  const refreshWorkload = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setWorkload(await fetchWorkloadStatus());
    } catch {
      // silent
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshWorkload();
    const id = setInterval(() => { void refreshWorkload(); }, WORKLOAD_REFRESH_MS);
    return () => clearInterval(id);
  }, [isAdmin, refreshWorkload]);

  const loadClientSnapshot = useCallback(async () => {
    if (!isClient || !clientId) return;

    setClientLoading((current) => current || clientSnapshot === null);

    try {
      const [orders, stockItems, movements, alerts] = await Promise.all([
        fetchOrders(),
        fetchStock({ clientId }),
        fetchStockMovements(24),
        fetchAlerts({ active_only: true }),
      ]);

      setClientSnapshot(buildClientSnapshot(orders, stockItems, movements, alerts));
      setClientLastUpdatedAt(new Date());
      setClientError(null);
    } catch {
      setClientError('No pudimos actualizar la vista del cliente en este momento.');
    } finally {
      setClientLoading(false);
    }
  }, [clientId, clientSnapshot, isClient]);

  useEffect(() => {
    if (!isClient || !clientId) return;

    void loadClientSnapshot();
    const intervalId = setInterval(() => { void loadClientSnapshot(); }, CLIENT_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [clientId, isClient, loadClientSnapshot]);

  const cards = [
    { label: 'Pedidos pendientes', value: pendingOrders, color: 'text-gray-900', link: '/orders' },
    {
      label: 'Alertas activas',
      value: pendingAlertNoticeCount,
      color: pendingAlertNoticeCount > 0 ? 'text-red-700' : 'text-gray-900',
      link: '/alerts',
    },
    { label: 'Despachados hoy', value: dispatchedToday, color: 'text-gray-900', link: '/orders' },
  ];

  if (isClient && clientId) {
    const maxWeeklyValue = Math.max(...(clientSnapshot?.weeklyBars.map((item) => item.value) ?? [0]), 1);
    const clientCards = clientSnapshot
      ? [
          {
            label: 'Stock disponible',
            value: formatCompactNumber(clientSnapshot.stockAvailable),
            detail: `${clientSnapshot.trackedProducts} SKU`,
            helper: `${clientSnapshot.lowStockProducts} con alerta baja`,
            icon: Boxes,
            accent: 'text-[#7E00D5]',
            cardClass: 'border-violet-200 bg-violet-50',
            iconClass: 'bg-violet-600 text-white',
            link: '/stock',
          },
          {
            label: 'Pedidos activos',
            value: formatCompactNumber(clientSnapshot.activeOrders),
            detail: `${clientSnapshot.preparingOrders} en preparación`,
            helper: `${clientSnapshot.readyOrders} listos`,
            icon: PackageCheck,
            accent: 'text-blue-700',
            cardClass: 'border-blue-200 bg-blue-50',
            iconClass: 'bg-blue-600 text-white',
          },
          {
            label: 'Enviados hoy',
            value: formatCompactNumber(clientSnapshot.dispatchedToday),
            detail: `${clientSnapshot.returnsInProgress} devoluciones`,
            helper: clientSnapshot.openAlerts > 0 ? `${clientSnapshot.openAlerts} alertas activas` : 'Sin alertas',
            icon: Truck,
            accent: clientSnapshot.openAlerts > 0 ? 'text-amber-700' : 'text-blue-700',
            cardClass: 'border-cyan-200 bg-cyan-50',
            iconClass: 'bg-cyan-600 text-white',
          },
          {
            label: 'Stock reservado',
            value: formatCompactNumber(clientSnapshot.stockReserved),
            detail: 'unidades comprometidas',
            helper: `${clientSnapshot.outOfStockProducts} sin stock`,
            icon: AlertTriangle,
            accent: 'text-gray-700',
            cardClass: 'border-slate-200 bg-slate-100',
            iconClass: 'bg-slate-700 text-white',
            link: '/stock',
          },
        ]
      : [];

    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
          <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#7E00D5]" />
                  Dashboard en vivo
                </div>
                <h1 className="mt-3 text-2xl font-bold tracking-tight text-[#3F63E8] sm:text-[2rem]">Resumen rápido de tu operación.</h1>
                <p className="mt-1 text-sm text-gray-500">Stock, movimiento y facturación en una sola vista.</p>
              </div>

              <div className="flex items-center gap-3 self-start rounded-xl border border-gray-200 bg-white px-4 py-2.5">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-gray-400">Actualizado</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">{formatClock(clientLastUpdatedAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { void loadClientSnapshot(); }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                  aria-label="Actualizar dashboard"
                >
                  <RefreshCw size={16} className={clientLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {clientCards.map((card) => {
                const Icon = card.icon;
                const isInteractive = Boolean(card.link);
                return (
                  <div
                    key={card.label}
                    onClick={isInteractive ? () => navigate(card.link as string) : undefined}
                    className={`group rounded-xl border p-4 text-left transition ${card.cardClass} ${isInteractive ? 'cursor-pointer hover:shadow-sm' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-sm ${card.iconClass}`}>
                        <Icon size={18} />
                      </span>
                      {isInteractive ? <ArrowUpRight size={16} className="text-gray-500" /> : <span className="h-4 w-4" />}
                    </div>
                    <p className="mt-4 text-sm text-gray-600">{card.label}</p>
                    <p className="mt-1 text-4xl font-semibold leading-none tracking-tight text-gray-900">{card.value}</p>
                    <p className={`mt-2 text-sm font-medium ${card.accent}`}>{card.detail}</p>
                    <p className="mt-0.5 text-xs text-gray-600">{card.helper}</p>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr_1fr]">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Despachos esta semana</p>
                    <p className="mt-1 text-sm text-gray-500">Últimos 7 días.</p>
                  </div>
                </div>

                <div className="mt-5 flex h-32 items-end gap-2 sm:gap-3">
                  {(clientSnapshot?.weeklyBars ?? []).map((item) => {
                    const height = `${Math.max((item.value / maxWeeklyValue) * 100, item.value > 0 ? 22 : 14)}%`;
                    return (
                      <div key={item.key} className="flex flex-1 flex-col items-center gap-2">
                        <div className="flex h-full w-full items-end rounded-2xl bg-gray-100 p-1">
                          <div
                            className={`w-full rounded-xl ${item.value > 0 ? 'bg-[#5B6CF0]' : 'bg-gray-200'}`}
                            style={{ height }}
                          />
                        </div>
                        <div className="text-center">
                          <div className={`text-xs font-semibold ${item.isToday ? 'text-gray-900' : 'text-gray-500'}`}>{item.label}</div>
                          <div className="mt-0.5 text-xs text-gray-400">{item.value}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Stock</p>
                    <p className="mt-1 text-sm text-gray-500">Indicadores rápidos.</p>
                  </div>
                  <Boxes size={16} className="text-gray-400" />
                </div>

                <div className="mt-4 space-y-2.5">
                  <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
                    <span className="text-sm text-gray-500">Reservado</span>
                    <span className="text-sm font-semibold text-gray-900">{formatCompactNumber(clientSnapshot?.stockReserved ?? 0)} u.</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
                    <span className="text-sm text-gray-500">Bajo mínimo</span>
                    <span className="text-sm font-semibold text-amber-700">{formatCompactNumber(clientSnapshot?.lowStockProducts ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
                    <span className="text-sm text-gray-500">Sin stock</span>
                    <span className="text-sm font-semibold text-rose-700">{formatCompactNumber(clientSnapshot?.outOfStockProducts ?? 0)}</span>
                  </div>
                  <button type="button" onClick={() => navigate('/stock')} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50">
                    Ver stock completo
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">Actividad reciente</p>
                    <p className="mt-1 text-sm text-gray-500">Últimos movimientos.</p>
                  </div>
                  <Activity size={16} className="text-gray-400" />
                </div>

                <div className="mt-4 space-y-2.5">
                  {(clientSnapshot?.activity ?? []).length > 0 ? (clientSnapshot?.activity ?? []).slice(0, 4).map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.id} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
                        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${getToneClasses(item.tone)}`}>
                          <Icon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                          <p className="truncate text-xs text-gray-500">{item.subtitle}</p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">{formatRelativeTime(item.createdAt)}</span>
                      </div>
                    );
                  }) : (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                      Sin movimientos recientes.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {clientError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {clientError}
              </div>
            )}
          </div>
        </section>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🛒</span>
              <h2 className="text-sm font-bold text-gray-900">Mercado Libre</h2>
            </div>
            <span className="text-xs text-gray-500">Sincronización comercial</span>
          </div>

          <div className="px-4 py-4">
            {mlAccount ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(26,170,245,0.12)] px-2.5 py-1 text-xs font-medium text-[#1F2BCC]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#1AAAF5]" /> Conectado
                  </span>
                  <span className="text-sm text-gray-900 font-medium">{mlAccount.ml_nickname || mlAccount.ml_user_id}</span>
                  <span className="text-xs text-gray-500">desde {new Date(mlAccount.connected_at).toLocaleDateString('es-AR')}</span>
                </div>
                <button
                  disabled={mlDisconnecting}
                  onClick={async () => {
                    setMlDisconnecting(true);
                    try {
                      await disconnectMLAccount(clientId);
                      setMlAccount(null);
                    } catch {
                      // ignore
                    } finally {
                      setMlDisconnecting(false);
                    }
                  }}
                  className="border border-red-200 bg-white text-red-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 transition"
                >
                  {mlDisconnecting ? 'Desconectando...' : 'Desconectar'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-500">Conectá tu cuenta para seguir pedidos marketplace desde el mismo tablero.</p>
                <button
                  disabled={mlLoading}
                  onClick={async () => {
                    setMlLoading(true);
                    try {
                      setClientError(null);
                      const url = await getMLAuthUrl(clientId);
                      window.location.href = url;
                    } catch (error) {
                      setClientError(getApiErrorMessage(error, 'No pudimos iniciar la conexión con Mercado Libre.'));
                      setMlLoading(false);
                    }
                  }}
                  className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  {mlLoading ? 'Redirigiendo...' : 'Conectar Mercado Libre'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Dashboard</h1>
      <p className="text-gray-500">Bienvenido al sistema de stock y fulfillment.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        {cards.map((card) => (
          <div
            key={card.label}
            onClick={() => navigate(card.link)}
            className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 cursor-pointer hover:border-blue-300 hover:shadow-md"
          >
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-3xl font-bold mt-1 ${card.color}`}>{card.value !== null ? card.value : '—'}</p>
          </div>
        ))}
      </div>

      {visibleAlertNoticeCount > 0 && (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 shadow-sm">
          <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg leading-none">⚠️</span>
              <div>
                <h2 className="text-sm font-bold text-red-900">
                  {visibleAlertNoticeCount} alerta{visibleAlertNoticeCount !== 1 ? 's' : ''} nueva{visibleAlertNoticeCount !== 1 ? 's' : ''}
                </h2>
                <p className="text-sm text-red-700">Hay incidencias pendientes para revisar.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { openAlertsPanel().catch(() => {}); }} className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-900 hover:bg-gray-50 transition">
                Ver alertas
              </button>
              <button type="button" onClick={() => navigate('/alerts')} className="px-4 py-2 rounded-lg text-sm font-medium text-blue-700 hover:text-blue-800 transition">
                Ir a alertas
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && workload && (workload.saturated_zones.length > 0 || workload.idle_operators.length > 0 || workload.busy_operators.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mt-8 overflow-hidden border-yellow-200">
          <div className="px-6 py-4 border-b border-yellow-200 flex items-center justify-between bg-yellow-50">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚖️</span>
              <h2 className="text-sm font-bold text-yellow-800">Balance de carga</h2>
              {workload.saturated_zones.length > 0 && (
                <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-0.5 rounded-full">
                  {workload.saturated_zones.length} zona{workload.saturated_zones.length !== 1 ? 's' : ''} saturada{workload.saturated_zones.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button onClick={() => navigate('/orders')} className="text-sm text-yellow-800 hover:opacity-80 font-medium">Ver pedidos →</button>
          </div>

          {workload.message && (
            <div className="px-6 py-3 bg-yellow-50 border-b border-yellow-200">
              <p className="text-sm text-yellow-800 font-medium">{workload.message}</p>
            </div>
          )}

          {workload.saturated_zones.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-200/60">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Zonas saturadas (&gt;5 pendientes)</h3>
              <div className="flex flex-wrap gap-2">
                {workload.saturated_zones.map((zone) => (
                  <button
                    key={zone.zone}
                    onClick={() => navigate(`/orders?zone=${zone.zone}&status=pending`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
                  >
                    <span className="font-bold">Zona {zone.zone}</span>
                    <span className="rounded-full bg-red-600/20 text-red-700 px-1.5 py-0.5 text-xs font-bold">{zone.pending}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {workload.zones.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-200/60">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pedidos pendientes por zona</h3>
              <div className="flex flex-wrap gap-2">
                {workload.zones.map((zone) => {
                  const isSaturated = zone.pending > 5;
                  return (
                    <div key={zone.zone} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${isSaturated ? 'border-red-200 bg-white text-gray-900' : 'border-gray-200 bg-white text-gray-900'}`}>
                      <span className="font-medium">Zona {zone.zone}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${isSaturated ? 'bg-red-600/20 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{zone.pending}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Operarios</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {workload.idle_operators.map((operator) => (
                <div key={operator.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${operator.pending_zone_orders > 0 ? 'border-yellow-200 bg-white' : 'border-green-200 bg-white'}`}>
                  <div className={`w-2 h-2 rounded-full ${operator.pending_zone_orders > 0 ? 'bg-amber-500' : 'bg-green-600'}`} />
                  <span className="text-sm font-medium text-gray-900">{operator.name}</span>
                  <span className="text-xs text-gray-500">{operator.zones.length > 0 ? `Zona${operator.zones.length > 1 ? 's' : ''} ${operator.zones.join(', ')}` : 'Sin zona'}</span>
                  <span className="ml-auto text-xs font-semibold text-gray-500">{operator.pending_zone_orders > 0 ? 'Disponible con trabajo pendiente' : 'Disponible'}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${operator.pending_zone_orders > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-700'}`}>
                    {operator.pending_zone_orders} pendiente{operator.pending_zone_orders !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
              {workload.busy_operators.map((operator) => (
                <div key={operator.id} className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2">
                  <div className="w-2 h-2 rounded-full bg-red-600" />
                  <span className="text-sm font-medium text-gray-900">{operator.name}</span>
                  <span className="text-xs text-gray-500">{operator.zones.length > 0 ? `Zona${operator.zones.length > 1 ? 's' : ''} ${operator.zones.join(', ')}` : 'Sin zona'}</span>
                  <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">Ocupado</span>
                  <span className="text-xs text-gray-500 font-medium">{operator.has_active_batch ? 'Batch activo' : `${operator.orders} pedido${operator.orders !== 1 ? 's' : ''} en picking`}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
