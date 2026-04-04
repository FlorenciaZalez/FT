import { useEffect, useMemo, useState } from 'react';
import {
  fetchReturnOrders,
  receiveReturn,
  type Order,
  type OrderItem,
  type ReceiveReturnPayload,
} from '../services/orders';
import SuccessToast from '../components/SuccessToast';

const STATUS_LABELS: Record<string, string> = {
  awaiting_return: 'Esperando devolución',
  returned_pending_review: 'Devuelto pendiente de revisión',
  returned_completed: 'Devolución completada',
};

const STATUS_COLORS: Record<string, string> = {
  awaiting_return: 'bg-yellow-50 text-yellow-800',
  returned_pending_review: 'bg-blue-50 text-blue-700',
  returned_completed: 'bg-green-50 text-green-700',
};

const CONDITION_OPTIONS: Array<{ value: ReceiveReturnPayload['condition']; label: string; hint: string }> = [
  { value: 'good', label: 'Buen estado', hint: 'Reingresa a stock' },
  { value: 'damaged', label: 'Dañado', hint: 'No reingresa a stock' },
];

function getPendingItems(order: Order): OrderItem[] {
  const receivedIds = new Set(order.return_receptions.map((reception) => reception.order_item_id));
  return order.items.filter((item) => !receivedIds.has(item.id));
}

export default function Returns() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [modalOrder, setModalOrder] = useState<Order | null>(null);
  const [modalItem, setModalItem] = useState<OrderItem | null>(null);
  const [condition, setCondition] = useState<ReceiveReturnPayload['condition']>('good');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadOrders = async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const data = await fetchReturnOrders();
      setOrders(data);
      setError('');
    } catch {
      setError('No se pudieron cargar las devoluciones');
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders(true);
    const intervalId = window.setInterval(() => {
      loadOrders(false).catch(() => {});
    }, 8000);
    return () => window.clearInterval(intervalId);
  }, []);

  const pendingCount = useMemo(
    () => orders.reduce((acc, order) => acc + getPendingItems(order).length, 0),
    [orders],
  );

  const openModal = (order: Order, item: OrderItem) => {
    setModalOrder(order);
    setModalItem(item);
    setCondition('good');
    setNotes('');
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOrder(null);
    setModalItem(null);
    setCondition('good');
    setNotes('');
  };

  const handleReceive = async () => {
    if (!modalOrder || !modalItem) return;
    setSubmitting(true);
    try {
      const result = await receiveReturn({
        order_id: modalOrder.id,
        sku: modalItem.sku,
        condition,
        notes: notes || undefined,
      });
      setOrders((current) => current.map((order) => (order.id === result.order.id ? result.order : order)));
      closeModal();
      const locationText = result.reception.stock_location_code
        ? ` Ubicación: ${result.reception.stock_location_code}.`
        : '';
      setSuccessMsg(`Producto recibido correctamente.${locationText}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'No se pudo registrar la devolución';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recepción de devoluciones</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestioná pedidos marcados para logística inversa y registrá el estado de cada SKU recibido.
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 min-w-56">
          <div className="text-xs uppercase tracking-wide text-gray-500">Pendientes</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{pendingCount}</div>
          <div className="text-sm text-gray-500">SKU por recepcionar</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {successMsg && <SuccessToast message={successMsg} onClose={() => setSuccessMsg('')} />}

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500">
          Cargando devoluciones...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500">
          No hay pedidos en logística inversa.
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const pendingItems = getPendingItems(order);
            return (
              <section key={order.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-gray-900">{order.order_number}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[order.status] ?? 'bg-gray-50 text-gray-900'}`}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      Cliente: <strong>{order.client_name ?? `#${order.client_id}`}</strong>
                      {' · '}Comprador: {order.buyer_name || 'Sin nombre'}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      Última actualización: {new Date(order.updated_at).toLocaleString('es-AR')}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
                    <div>Pendientes: <strong>{pendingItems.length}</strong></div>
                    <div>Recibidos: <strong>{order.return_receptions.length}</strong></div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {order.items.map((item) => {
                    const reception = order.return_receptions.find((entry) => entry.order_item_id === item.id);
                    const isReceived = Boolean(reception);
                    return (
                      <article
                        key={item.id}
                        className={`rounded-xl border px-4 py-4 ${isReceived ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{item.sku}</div>
                            <div className="text-xs text-gray-500 mt-1">Cantidad: {item.quantity}</div>
                            {item.location_code && (
                              <div className="text-xs text-gray-500 mt-1">Ubicación original: {item.location_code}</div>
                            )}
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${isReceived ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-800'}`}>
                            {isReceived ? 'Recibido' : 'Pendiente'}
                          </span>
                        </div>

                        {reception ? (
                          <div className="mt-3 space-y-1 text-xs text-gray-500">
                            <div>Condición: <strong>{reception.condition}</strong></div>
                            {reception.stock_location_code && <div>Ubicación: <strong>{reception.stock_location_code}</strong></div>}
                            <div>Recibido por: <strong>{reception.received_by_name ?? 'Sin dato'}</strong></div>
                            {reception.notes && <div>Notas: {reception.notes}</div>}
                          </div>
                        ) : (
                          <button
                            onClick={() => openModal(order, item)}
                            className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
                          >
                            Recibir producto
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {modalOrder && modalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-blue-700/30 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Recibir producto</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Pedido {modalOrder.order_number} · SKU {modalItem.sku}
                </p>
              </div>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-500">✕</button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-900">Condición</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CONDITION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setCondition(option.value)}
                      className={`rounded-xl border px-3 py-3 text-left transition-all duration-150 ease-out active:scale-[0.98] ${condition === option.value ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-white text-gray-900 hover:border-gray-200'}`}
                    >
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className={`mt-1 text-xs ${condition === option.value ? 'text-white' : 'text-gray-500'}`}>
                        {option.hint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-900">Observaciones</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-primary"
                  placeholder="Ej: caja mojada, producto completo, empaque abierto"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-900 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReceive}
                disabled={submitting}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Registrando...' : 'Confirmar recepción'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
