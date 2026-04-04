import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { fetchOrders, fetchWorkloadStatus } from '../services/orders';
import type { Order, WorkloadStatus } from '../services/orders';
import { getMLAuthUrl, disconnectMLAccount, getMLAccount, type MLAccount } from '../services/mercadolibre';
import type { DashboardLayoutContext } from '../layouts/DashboardLayout';

const WORKLOAD_REFRESH_MS = 8_000;

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { visibleAlertNoticeCount, openAlertsPanel } = useOutletContext<DashboardLayoutContext>();
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  const [dispatchedToday, setDispatchedToday] = useState<number | null>(null);
  const [workload, setWorkload] = useState<WorkloadStatus | null>(null);
  const isAdmin = user?.role === 'admin';
  const isClient = user?.role === 'client';
  const clientId = user?.client_id ?? null;
  const cancelledRef = useRef(false);
  const [mlAccount, setMlAccount] = useState<MLAccount | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlDisconnecting, setMlDisconnecting] = useState(false);
  const pendingAlertNoticeCount = visibleAlertNoticeCount;

  useEffect(() => {
    cancelledRef.current = false;
    async function load() {
      try {
        const orders = await fetchOrders();
        if (cancelledRef.current) return;
        setPendingOrders(orders.filter((o: Order) => o.status === 'pending').length);
        const today = new Date().toISOString().slice(0, 10);
        setDispatchedToday(
          orders.filter(
            (o: Order) => o.status === 'dispatched' && o.dispatched_at?.slice(0, 10) === today,
          ).length,
        );
      } catch {
        // silently fail
      }
    }
    load();
    return () => { cancelledRef.current = true; };
  }, []);

  // Load ML account for client users
  useEffect(() => {
    if (!isClient || !clientId) return;
    getMLAccount(clientId)
      .then(setMlAccount)
      .catch(() => setMlAccount(null));
  }, [isClient, clientId]);

  // Workload polling (admin only)
  const refreshWorkload = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setWorkload(await fetchWorkloadStatus());
    } catch { /* silent */ }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    refreshWorkload();
    const id = setInterval(refreshWorkload, WORKLOAD_REFRESH_MS);
    return () => clearInterval(id);
  }, [isAdmin, refreshWorkload]);

  const cards = [
    {
      label: 'Pedidos pendientes',
      value: pendingOrders,
      color: 'text-gray-900',
      link: '/orders',
    },
    {
      label: 'Alertas activas',
      value: pendingAlertNoticeCount,
      color: pendingAlertNoticeCount > 0 ? 'text-red-700' : 'text-gray-900',
      link: '/alerts',
    },
    {
      label: 'Despachados hoy',
      value: dispatchedToday,
      color: 'text-gray-900',
      link: '/orders',
    },
  ];

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
            <p className={`text-3xl font-bold mt-1 ${card.color}`}>
              {card.value !== null ? card.value : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Mercado Libre — client role only */}
      {isClient && clientId && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mt-8 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2 bg-gray-50">
            <span className="text-lg">🛒</span>
            <h2 className="text-sm font-bold text-gray-900">Mercado Libre</h2>
          </div>
          <div className="px-6 py-5">
            {mlAccount ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    <span className="w-1.5 h-1.5 bg-green-600 rounded-full" /> Conectado
                  </span>
                  <span className="text-sm text-gray-900 font-medium">
                    {mlAccount.ml_nickname || mlAccount.ml_user_id}
                  </span>
                  <span className="text-xs text-gray-500">
                    desde {new Date(mlAccount.connected_at).toLocaleDateString('es-AR')}
                  </span>
                </div>
                <button
                  disabled={mlDisconnecting}
                  onClick={async () => {
                    setMlDisconnecting(true);
                    try {
                      await disconnectMLAccount(clientId);
                      setMlAccount(null);
                    } catch { /* ignore */ }
                    finally { setMlDisconnecting(false); }
                  }}
                  className="border border-gray-200 bg-white text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition border-red-200 text-red-700 hover:bg-red-50"
                >
                  {mlDisconnecting ? 'Desconectando...' : 'Desconectar'}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">Cuenta no conectada</p>
                <button
                  disabled={mlLoading}
                  onClick={async () => {
                    setMlLoading(true);
                    try {
                      const url = await getMLAuthUrl(clientId);
                      console.log('[ML OAuth] Redirect URL:', url);
                      window.location.href = url;
                    } catch { setMlLoading(false); }
                  }}
                  className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  {mlLoading ? 'Redirigiendo...' : 'Conectar Mercado Libre'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
              <button
                type="button"
                onClick={() => { openAlertsPanel().catch(() => {}); }}
                className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Ver alertas
              </button>
              <button
                type="button"
                onClick={() => navigate('/alerts')}
                className="px-4 py-2 rounded-lg text-sm font-medium text-blue-700 hover:text-blue-800 transition"
              >
                Ir a alertas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workload balance widget — admin only */}
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
            <button
              onClick={() => navigate('/orders')}
              className="text-sm text-yellow-800 hover:opacity-80 font-medium"
            >
              Ver pedidos →
            </button>
          </div>

          {/* Alert message */}
          {workload.message && (
            <div className="px-6 py-3 bg-yellow-50 border-b border-yellow-200">
              <p className="text-sm text-yellow-800 font-medium">{workload.message}</p>
            </div>
          )}

          {/* Saturated zones */}
          {workload.saturated_zones.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-200/60">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Zonas saturadas (&gt;5 pendientes)</h3>
              <div className="flex flex-wrap gap-2">
                {workload.saturated_zones.map((z) => (
                  <button
                    key={z.zone}
                    onClick={() => navigate(`/orders?zone=${z.zone}&status=pending`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
                  >
                    <span className="font-bold">Zona {z.zone}</span>
                    <span className="rounded-full bg-red-600/20 text-red-700 px-1.5 py-0.5 text-xs font-bold">{z.pending}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* All zones overview */}
          {workload.zones.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-200/60">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Pedidos pendientes por zona</h3>
              <div className="flex flex-wrap gap-2">
                {workload.zones.map((z) => {
                  const isSaturated = z.pending > 5;
                  return (
                    <div
                      key={z.zone}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${isSaturated ? 'border-red-200 bg-white text-gray-900' : 'border-gray-200 bg-white text-gray-900'}`}
                    >
                      <span className="font-medium">Zona {z.zone}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${isSaturated ? 'bg-red-600/20 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                        {z.pending}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Operators */}
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Operarios</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {workload.idle_operators.map((op) => (
                <div
                  key={op.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${op.pending_zone_orders > 0 ? 'border-yellow-200 bg-white' : 'border-green-200 bg-white'}`}
                >
                  <div className={`w-2 h-2 rounded-full ${op.pending_zone_orders > 0 ? 'bg-amber-500' : 'bg-green-600'}`} />
                  <span className="text-sm font-medium text-gray-900">{op.name}</span>
                  <span className="text-xs text-gray-500">
                    {op.zones.length > 0 ? `Zona${op.zones.length > 1 ? 's' : ''} ${op.zones.join(', ')}` : 'Sin zona'}
                  </span>
                  <span className="ml-auto text-xs font-semibold text-gray-500">
                    {op.pending_zone_orders > 0 ? 'Disponible con trabajo pendiente' : 'Disponible'}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${op.pending_zone_orders > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-700'}`}>
                    {op.pending_zone_orders} pendiente{op.pending_zone_orders !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
              {workload.busy_operators.map((op) => (
                <div key={op.id} className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2">
                  <div className="w-2 h-2 rounded-full bg-red-600" />
                  <span className="text-sm font-medium text-gray-900">{op.name}</span>
                  <span className="text-xs text-gray-500">
                    {op.zones.length > 0 ? `Zona${op.zones.length > 1 ? 's' : ''} ${op.zones.join(', ')}` : 'Sin zona'}
                  </span>
                  <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">Ocupado</span>
                  <span className="text-xs text-gray-500 font-medium">
                    {op.has_active_batch
                      ? 'Batch activo'
                      : `${op.orders} pedido${op.orders !== 1 ? 's' : ''} en picking`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
