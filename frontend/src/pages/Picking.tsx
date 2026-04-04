import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOrders, fetchPickableOrders, printPendingLabels, type Order } from '../services/orders';
import {
  fetchActiveBatchPickingSession,
  startBatchPickingSession,
  type BatchPickingSession,
} from '../services/batchPicking';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  in_preparation: 'En preparación',
  prepared: 'Preparado',
};

export default function Picking() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [pendingLabelsLoading, setPendingLabelsLoading] = useState(false);
  const [pendingLabelsCount, setPendingLabelsCount] = useState(0);
  const [pendingLabelsFeedback, setPendingLabelsFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [hasActiveBatchSession, setHasActiveBatchSession] = useState(false);
  const [previewSession, setPreviewSession] = useState<BatchPickingSession | null>(null);

  useEffect(() => {
    fetchPickableOrders()
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));

    fetchActiveBatchPickingSession()
      .then((session) => {
        setHasActiveBatchSession(true);
        setPreviewSession(session);
      })
      .catch(() => setHasActiveBatchSession(false));

    fetchOrders('prepared')
      .then((preparedOrders) => {
        setPendingLabelsCount(preparedOrders.filter((order) => Boolean(order.shipping_id) && !order.label_printed).length);
      })
      .catch(() => setPendingLabelsCount(0));
  }, []);

  const handleStartBatchPicking = async () => {
    setBatchLoading(true);
    setBatchError('');
    try {
      const session = hasActiveBatchSession && previewSession
        ? previewSession
        : await startBatchPickingSession();
      setPreviewSession(session);
      setHasActiveBatchSession(session.status === 'active');
      navigate(`/picking/batch/${session.id}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'No se pudo iniciar el picking masivo';
      setBatchError(msg);
    } finally {
      setBatchLoading(false);
    }
  };

  const handlePrintPendingLabels = async () => {
    setPendingLabelsLoading(true);
    setPendingLabelsFeedback(null);
    try {
      const result = await printPendingLabels();
      const preparedOrders = await fetchOrders('prepared');
      setPendingLabelsCount(preparedOrders.filter((order) => Boolean(order.shipping_id) && !order.label_printed).length);
      const warning = result.failedCount > 0 ? ` ${result.failedCount} no se pudieron generar.` : '';
      setPendingLabelsFeedback({
        type: 'success',
        message: `Se generaron ${result.generatedCount} etiqueta${result.generatedCount !== 1 ? 's' : ''}.${warning}`,
      });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'No se pudieron imprimir las etiquetas pendientes';
      setPendingLabelsFeedback({ type: 'error', message: msg });
    } finally {
      setPendingLabelsLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Picking</h1>
          <p className="text-gray-500 text-sm mt-1">Seleccioná un pedido para preparar o iniciá un picking masivo por SKU</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={handlePrintPendingLabels}
            disabled={pendingLabelsLoading || pendingLabelsCount === 0}
            className="ui-btn-primary px-5 py-3 rounded-xl text-sm font-bold disabled:opacity-50 whitespace-nowrap"
          >
            {pendingLabelsLoading ? 'Generando...' : 'Imprimir etiquetas'}
          </button>
          <button
            onClick={handleStartBatchPicking}
            disabled={batchLoading}
            className="ui-btn-primary px-5 py-3 rounded-xl text-sm font-bold disabled:opacity-50 whitespace-nowrap"
          >
            {batchLoading
              ? 'Preparando sesión...'
              : hasActiveBatchSession
                ? 'Continuar picking masivo'
                : 'Iniciar picking masivo'}
          </button>
        </div>
      </div>

      {pendingLabelsFeedback && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${pendingLabelsFeedback.type === 'success' ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
          {pendingLabelsFeedback.message}
        </div>
      )}

      {batchError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          {batchError}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-500 py-12">Cargando pedidos...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">✅</div>
          <p className="text-gray-500 text-lg">No hay pedidos pendientes de picking</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const totalItems = order.items.reduce((s, i) => s + i.quantity, 0);
            const pickedItems = order.items.reduce((s, i) => s + i.picked_quantity, 0);
            const progress = totalItems > 0 ? Math.round((pickedItems / totalItems) * 100) : 0;

            return (
              <div key={order.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-gray-900">{order.order_number}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      order.status === 'pending' ? 'bg-yellow-50 text-yellow-800' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {order.client_name ?? `Cliente #${order.client_id}`} · {order.items.length} producto{order.items.length !== 1 ? 's' : ''} · {totalItems} unid.
                  </p>
                  {(() => {
                    const locs = [...new Set(order.items.map(i => i.location_code).filter(Boolean))] as string[];
                    if (locs.length === 0) return null;
                    return (
                      <p className="text-xs text-gray-500 mt-1">
                        📍 {locs.sort().join(', ')}
                      </p>
                    );
                  })()}
                  {pickedItems > 0 && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-50 rounded-full h-1.5">
                        <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 mt-0.5">{pickedItems}/{totalItems} escaneados</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/picking/${order.id}`)}
                  className="ui-btn-primary px-6 py-3 rounded-xl text-sm font-bold whitespace-nowrap"
                >
                  {pickedItems > 0 ? 'Continuar picking' : 'Iniciar picking'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

