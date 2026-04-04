import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrder, advanceOrder, cancelOrder, generateManualLabel, markOrderAwaitingReturn, printOrderLabel, type Order } from '../services/orders';
import SuccessToast from '../components/SuccessToast';

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

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-800',
  in_preparation: 'bg-blue-50 text-blue-700',
  prepared: 'bg-blue-50 text-blue-700',
  dispatched: 'bg-green-50 text-green-700',
  awaiting_return: 'bg-yellow-50 text-yellow-800',
  returned_pending_review: 'bg-blue-50 text-blue-700',
  returned_completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

const SHIPPING_STATUS_LABELS: Record<string, string> = {
  calculated: 'Calculado',
  zone_undefined: 'Zona no definida',
  rate_undefined: 'Costo logístico no definido',
};

const SHIPPING_STATUS_COLORS: Record<string, string> = {
  calculated: 'bg-green-50 text-green-700',
  zone_undefined: 'bg-yellow-50 text-yellow-800',
  rate_undefined: 'bg-red-50 text-red-700',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  mercadolibre: 'MercadoLibre',
};

const SOURCE_COLORS: Record<string, string> = {
  manual: 'bg-gray-50 text-gray-900',
  mercadolibre: 'bg-yellow-50 text-yellow-800',
};

const MAPPING_STATUS_LABELS: Record<string, string> = {
  resolved: 'Mapping resuelto',
  unmapped: 'Sin mapping',
};

const MAPPING_STATUS_COLORS: Record<string, string> = {
  resolved: 'bg-green-50 text-green-700',
  unmapped: 'bg-red-50 text-red-700',
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
}

const STATUS_STEPS = ['pending', 'in_preparation', 'prepared', 'dispatched', 'awaiting_return', 'returned_pending_review', 'returned_completed'];

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showPickingConfirm, setShowPickingConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handlePrintLabel = async () => {
    if (!order) return;
    if (order.label_generated) {
      const confirmed = window.confirm(`Esta etiqueta ya fue impresa ${order.label_print_count} veces. ¿Deseás continuar?`);
      if (!confirmed) return;
    }

    setActionError('');
    setActionLoading(true);
    try {
      const result = await printOrderLabel(order.id);
      const refreshed = await fetchOrder(order.id);
      setOrder(refreshed);
      const warning = result.failedCount > 0 ? ` ${result.failedCount} intento(s) fallido(s).` : '';
      setSuccessMsg(`Se generó ${result.generatedCount} etiqueta.${warning}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo imprimir la etiqueta';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleGenerateManualLabel = async () => {
    if (!order) return;
    if (order.label_generated && order.label_type === 'manual') {
      const confirmed = window.confirm('Esta etiqueta ya fue generada anteriormente. ¿Deseás reimprimirla?');
      if (!confirmed) return;
    }

    setActionError('');
    setActionLoading(true);
    try {
      await generateManualLabel(order.id);
      const refreshed = await fetchOrder(order.id);
      setOrder(refreshed);
      setSuccessMsg('Se generó la etiqueta manual.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo generar la etiqueta manual';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchOrder(parseInt(id))
      .then(setOrder)
      .catch(() => setError('Error al cargar el pedido'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleAdvance = async () => {
    if (!order) return;
    setActionError('');
    setActionLoading(true);
    try {
      const updated = await advanceOrder(order.id);
      setOrder(updated);
      setSuccessMsg(`Estado avanzado a "${STATUS_LABELS[updated.status]}"`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al avanzar estado';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!order) return;
    setActionError('');
    setActionLoading(true);
    try {
      const updated = await cancelOrder(order.id);
      setOrder(updated);
      setSuccessMsg('Pedido cancelado');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al cancelar';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartPicking = async () => {
    if (!order) return;
    setActionError('');
    setActionLoading(true);
    try {
      await advanceOrder(order.id);
      setShowPickingConfirm(false);
      navigate(`/picking/${order.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al iniciar picking';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkAwaitingReturn = async () => {
    if (!order) return;
    setActionError('');
    setActionLoading(true);
    try {
      const updated = await markOrderAwaitingReturn(order.id);
      setOrder(updated);
      setSuccessMsg('Pedido marcado para recepción de devolución');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al marcar la devolución';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Cargando pedido...</div>;
  if (error || !order) return <div className="text-center py-12 text-red-700">{error || 'Pedido no encontrado'}</div>;

  const canCancel = !['dispatched', 'cancelled'].includes(order.status);
  const currentStepIdx = STATUS_STEPS.indexOf(order.status);
  const isUnmappedMarketplaceOrder = order.source === 'mercadolibre' && order.mapping_status === 'unmapped';
  const canPrintExternalLabel = Boolean(order.shipping_id) && order.status !== 'cancelled';
  const canPrintManualLabel = Boolean(
    order.source === 'manual'
    && order.operation_type === 'sale'
    && order.status !== 'cancelled'
    && (order.address_line || order.buyer_address)
    && (order.city || order.state || order.postal_code),
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/orders')}
            className="text-sm text-gray-500 hover:text-gray-900 mb-1 flex items-center gap-1"
          >
            ← Volver a pedidos
          </button>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            {order.order_number}
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[order.status] ?? 'bg-gray-50'}`}>
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${SOURCE_COLORS[order.source] ?? 'bg-gray-50 text-gray-500'}`}>
              {SOURCE_LABELS[order.source] ?? order.source}
            </span>
            {order.mapping_status && (
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${MAPPING_STATUS_COLORS[order.mapping_status] ?? 'bg-gray-50 text-gray-500'}`}>
                {MAPPING_STATUS_LABELS[order.mapping_status] ?? order.mapping_status}
              </span>
            )}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Cliente: <strong>{order.client_name ?? `#${order.client_id}`}</strong>
            {' · '}Creado: {new Date(order.created_at).toLocaleString('es-AR')}
          </p>
        </div>

        <div className="flex gap-3">
          {order.status === 'pending' && !isUnmappedMarketplaceOrder && (
            <button
              onClick={() => setShowPickingConfirm(true)}
              className="ui-btn-primary px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              📦 Iniciar picking
            </button>
          )}
          {order.status === 'pending' && isUnmappedMarketplaceOrder && (
            <button
              onClick={() => navigate('/integrations/ml/mappings')}
              className="bg-red-50 text-red-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-red-50 transition"
            >
              Resolver mapping
            </button>
          )}
          {order.status === 'in_preparation' && (
            <button
              onClick={() => navigate(`/picking/${order.id}`)}
              className="ui-btn-primary px-5 py-2.5 rounded-lg text-sm font-medium"
            >
              📦 Continuar picking
            </button>
          )}
          {order.status === 'prepared' && (
            <button
              onClick={handleAdvance}
              disabled={actionLoading}
              className="bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {actionLoading ? 'Procesando...' : '🚚 Despachar'}
            </button>
          )}
          {order.status === 'dispatched' && (
            <button
              onClick={handleMarkAwaitingReturn}
              disabled={actionLoading}
              className="bg-amber-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {actionLoading ? 'Procesando...' : '↩ Marcar devolución'}
            </button>
          )}
          {canPrintExternalLabel && (
            <button
              onClick={handlePrintLabel}
              disabled={actionLoading}
              className="bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {actionLoading ? 'Generando...' : order.label_generated ? 'Reimprimir etiqueta' : 'Imprimir etiqueta'}
            </button>
          )}
          {!canPrintExternalLabel && canPrintManualLabel && (
            <button
              onClick={handleGenerateManualLabel}
              disabled={actionLoading}
              className="bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {actionLoading ? 'Generando...' : order.label_generated && order.label_type === 'manual' ? 'Reimprimir etiqueta' : 'Imprimir etiqueta'}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={actionLoading}
              className="border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-red-50 transition disabled:opacity-50"
            >
              Cancelar pedido
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{actionError}</div>
      )}
      {order.source === 'manual' && order.label_generated && order.label_type === 'manual' && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3 mb-4">
          Etiqueta ya generada anteriormente. Podés reimprimirla desde este pedido.
        </div>
      )}
      {isUnmappedMarketplaceOrder && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          Este pedido ingresó desde MercadoLibre sin un SKU interno asociado. Debe resolverse desde la pantalla de mappings antes de iniciar el picking.
        </div>
      )}

      {successMsg && <SuccessToast message={successMsg} onClose={() => setSuccessMsg('')} />}

      {/* Status progress */}
      {order.status !== 'cancelled' && currentStepIdx >= 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-4">Progreso del pedido</h2>
          <div className="flex items-center">
            {STATUS_STEPS.map((step, idx) => {
              const isCompleted = idx <= currentStepIdx;
              const isCurrent = idx === currentStepIdx;
              return (
                <div key={step} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isCompleted
                          ? isCurrent
                            ? 'bg-primary text-white ring-4 ring-primary/20'
                            : 'bg-green-600 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isCompleted && !isCurrent ? '✓' : idx + 1}
                    </div>
                    <span className={`text-xs mt-1.5 ${isCurrent ? 'text-blue-700 font-medium' : 'text-gray-500'}`}>
                      {STATUS_LABELS[step]}
                    </span>
                  </div>
                  {idx < STATUS_STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 ${idx < currentStepIdx ? 'bg-green-600' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Order info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Información</h3>
          <div className="space-y-2 text-sm">
            <div><span className="text-gray-500">Origen:</span> <span className="font-medium">{SOURCE_LABELS[order.source] ?? order.source}</span></div>
            <div><span className="text-gray-500">Nº Pedido:</span> <span className="font-mono text-xs">{order.order_number}</span></div>
            {order.external_id && <div><span className="text-gray-500">ID externo:</span> <span className="font-mono text-xs">{order.external_id}</span></div>}
            {order.shipping_id && <div><span className="text-gray-500">Shipping ID:</span> <span className="font-mono text-xs">{order.shipping_id}</span></div>}
            {order.source_order_id && <div><span className="text-gray-500">ID origen:</span> <span className="font-mono text-xs">{order.source_order_id}</span></div>}
            {order.ml_item_id && <div><span className="text-gray-500">ML item:</span> <span className="font-mono text-xs">{order.ml_item_id}</span></div>}
            {order.variation_id && <div><span className="text-gray-500">Variación:</span> <span className="font-mono text-xs">{order.variation_id}</span></div>}
            <div>
              <span className="text-gray-500">Etiqueta:</span>{' '}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${order.label_generated ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-800'}`}>
                {order.label_generated ? (order.label_type === 'manual' ? 'Etiqueta manual generada' : 'Etiqueta impresa') : 'Pendiente de impresión'}
              </span>
            </div>
            <div><span className="text-gray-500">Impresiones:</span> <span className="font-medium">{order.label_print_count}</span></div>
            {order.requested_quantity !== null && order.requested_quantity !== undefined && (
              <div><span className="text-gray-500">Cantidad solicitada:</span> <span className="font-medium">{order.requested_quantity}</span></div>
            )}
            {order.mapping_status && (
              <div>
                <span className="text-gray-500">Estado mapping:</span>{' '}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${MAPPING_STATUS_COLORS[order.mapping_status] ?? 'bg-gray-50 text-gray-500'}`}>
                  {MAPPING_STATUS_LABELS[order.mapping_status] ?? order.mapping_status}
                </span>
              </div>
            )}
            {order.notes && <div><span className="text-gray-500">Notas:</span> {order.notes}</div>}
            {order.dispatch_carrier && (
              <div><span className="text-gray-500">Transportista:</span> <span className="font-medium">{order.dispatch_carrier}</span></div>
            )}
            {order.dispatch_batch_number && (
              <div><span className="text-gray-500">Lote despacho:</span> <span className="font-mono text-xs bg-gray-50 px-1.5 py-0.5 rounded">{order.dispatch_batch_number}</span></div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Fechas</h3>
          <div className="space-y-2 text-sm">
            <div><span className="text-gray-500">Creado:</span> {new Date(order.created_at).toLocaleString('es-AR')}</div>
            {order.dispatched_at && (
              <div><span className="text-gray-500">Despachado:</span> {new Date(order.dispatched_at).toLocaleString('es-AR')}</div>
            )}
            {order.label_generated_at && (
              <div><span className="text-gray-500">Última impresión:</span> {new Date(order.label_generated_at).toLocaleString('es-AR')}</div>
            )}
            {order.cancelled_at && (
              <div><span className="text-gray-500">Cancelado:</span> {new Date(order.cancelled_at).toLocaleString('es-AR')}</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">Resumen</h3>
          <div className="space-y-2 text-sm">
            <div><span className="text-gray-500">Total productos:</span> <span className="font-bold">{order.items.length}</span></div>
            <div>
              <span className="text-gray-500">Total unidades:</span>{' '}
              <span className="font-bold">{order.items.reduce((sum, i) => sum + i.quantity, 0)}</span>
            </div>
            <div><span className="text-gray-500">Cordón:</span> <span className="font-medium">{order.cordon ?? 'Sin definir'}</span></div>
            <div><span className="text-gray-500">Costo logístico:</span> <span className="font-bold">{order.shipping_cost !== null ? formatCurrency(order.shipping_cost) : 'No calculado'}</span></div>
            {order.shipping_status && (
              <div className="pt-1">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${SHIPPING_STATUS_COLORS[order.shipping_status] ?? 'bg-gray-50 text-gray-500'}`}>
                  {SHIPPING_STATUS_LABELS[order.shipping_status] ?? order.shipping_status}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {order.return_receptions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-3">Devoluciones registradas</h3>
          <div className="space-y-3">
            {order.return_receptions.map((reception) => (
              <div key={reception.id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-white px-2 py-0.5 font-mono text-xs text-gray-900">{reception.sku}</span>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-900">{reception.condition}</span>
                  {reception.stock_location_code && (
                    <span className="text-xs text-gray-500">Ubicación: {reception.stock_location_code}</span>
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Recibido por {reception.received_by_name ?? 'Sin dato'} el {new Date(reception.received_at).toLocaleString('es-AR')}
                </div>
                {reception.notes && <div className="mt-2 text-sm text-gray-500">{reception.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dirección de entrega */}
      {(order.address_line || order.city || order.state || order.buyer_address) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-3">📍 Dirección de entrega</h3>
          <div className="space-y-1">
            {(order.city || order.state) && (
              <p className="text-base font-semibold text-gray-900">
                {[order.city, order.state].filter(Boolean).join(', ')}
                {order.postal_code && <span className="text-gray-500 font-normal text-sm ml-1.5">({order.postal_code})</span>}
              </p>
            )}
            {order.address_line && (
              <p className="text-sm text-gray-500">{order.address_line}</p>
            )}
            {!order.address_line && order.buyer_address && (
              <p className="text-sm text-gray-500">{order.buyer_address}</p>
            )}
            {order.buyer_name && (
              <p className="text-sm text-gray-500">Destinatario: <span className="font-medium text-gray-900">{order.buyer_name}</span></p>
            )}
            {order.address_reference && (
              <p className="text-sm text-gray-500 italic">Ref: {order.address_reference}</p>
            )}
          </div>
          {(order.address_line || order.city) && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([order.address_line, order.city, order.state].filter(Boolean).join(', '))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 bg-blue-50 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-50 transition"
            >
              🗺️ Abrir en Google Maps
            </a>
          )}
        </div>
      )}

      {/* Items table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-900">Productos del pedido</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-6 py-3 font-medium text-gray-500">SKU</th>
              <th className="text-left px-6 py-3 font-medium text-gray-500">Producto ID</th>
              <th className="text-left px-6 py-3 font-medium text-gray-500">Ubicación</th>
              <th className="text-right px-6 py-3 font-medium text-gray-500">Cantidad</th>
              <th className="text-right px-6 py-3 font-medium text-gray-500">Picked</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="px-6 py-4">
                  <span className="bg-gray-50 text-gray-900 px-2 py-0.5 rounded font-mono text-xs">{item.sku}</span>
                </td>
                <td className="px-6 py-4 text-gray-500">#{item.product_id}</td>
                <td className="px-6 py-4 text-gray-500 text-xs">{item.location_code ?? '—'}</td>
                <td className="px-6 py-4 text-right font-bold">{item.quantity}</td>
                <td className="px-6 py-4 text-right">
                  <span
                    className={`font-medium ${
                      item.picked_quantity >= item.quantity
                        ? 'text-green-700'
                        : item.picked_quantity > 0
                          ? 'text-yellow-800'
                          : 'text-gray-500'
                    }`}
                  >
                    {item.picked_quantity}/{item.quantity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cancel Confirm Modal */}
      {showCancelConfirm && canCancel && (
        <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Cancelar pedido</h3>
            <p className="text-sm text-gray-500 mb-4">
              ¿Estás seguro que querés cancelar el pedido <strong>{order.order_number}</strong>?
              Se liberará el stock reservado y no se podrá revertir.
            </p>

            {actionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{actionError}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowCancelConfirm(false); setActionError(''); }}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Volver
              </button>
              <button
                onClick={async () => {
                  await handleCancel();
                  setShowCancelConfirm(false);
                }}
                disabled={actionLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 bg-red-600 hover:opacity-90 text-white"
              >
                {actionLoading ? 'Cancelando...' : 'Confirmar cancelación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Picking Confirm Modal */}
      {showPickingConfirm && order.status === 'pending' && (
        <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Iniciar picking</h3>
            <p className="text-sm text-gray-500 mb-4">
              {order.order_number} · {order.client_name ?? `#${order.client_id}`}
            </p>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded font-mono text-xs">{item.sku}</span>
                    <span className="text-gray-900">×{item.quantity}</span>
                  </div>
                </div>
              ))}
            </div>

            {actionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{actionError}</div>
            )}

            <p className="text-xs text-gray-500 mb-4">
              Al confirmar, el pedido pasará a "Preparando pedido" y se registrará la fecha y el usuario.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowPickingConfirm(false); setActionError(''); }}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Volver
              </button>
              <button
                onClick={handleStartPicking}
                disabled={actionLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {actionLoading ? 'Procesando...' : '📦 Confirmar e iniciar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
