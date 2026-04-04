import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrder, pickBySku, type Order } from '../services/orders';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  in_preparation: 'Preparando pedido',
  prepared: 'Listo para despacho',
};

const DEFAULT_LOCATION = 'DEFAULT';

function normalizeLocation(locationCode: string | null): string {
  return locationCode?.trim() || DEFAULT_LOCATION;
}

function compareLocationCodes(left: string | null, right: string | null): number {
  const leftValue = normalizeLocation(left);
  const rightValue = normalizeLocation(right);

  if (leftValue === DEFAULT_LOCATION && rightValue !== DEFAULT_LOCATION) return 1;
  if (rightValue === DEFAULT_LOCATION && leftValue !== DEFAULT_LOCATION) return -1;

  return leftValue.localeCompare(rightValue, 'es-AR', { numeric: true, sensitivity: 'base' });
}

export default function PickingSession() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    fetchOrder(parseInt(orderId))
      .then((o) => {
        if (cancelled) return;
        if (!['pending', 'in_preparation'].includes(o.status)) {
          setError(`Este pedido está en estado "${STATUS_LABELS[o.status] ?? o.status}" y no se puede preparar.`);
        } else {
          setOrder(o);
        }
      })
      .catch(() => { if (!cancelled) setError('Error al cargar el pedido'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [feedback, order]);

  const sortedItems = useMemo(() => {
    if (!order) return [];
    return [...order.items].sort((left, right) => {
      const locationOrder = compareLocationCodes(left.location_code, right.location_code);
      if (locationOrder !== 0) return locationOrder;
      return left.sku.localeCompare(right.sku, 'es-AR', { numeric: true, sensitivity: 'base' });
    });
  }, [order]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, typeof sortedItems>();
    sortedItems.forEach((item) => {
      const location = normalizeLocation(item.location_code);
      const current = groups.get(location) ?? [];
      current.push(item);
      groups.set(location, current);
    });

    return Array.from(groups.entries()).map(([location, items]) => ({
      location,
      items,
      pickedUnits: items.reduce((sum, item) => sum + item.picked_quantity, 0),
      totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
      completedItems: items.filter((item) => item.picked_quantity >= item.quantity).length,
    }));
  }, [sortedItems]);

  const nextPendingItem = useMemo(
    () => sortedItems.find((item) => item.picked_quantity < item.quantity) ?? null,
    [sortedItems],
  );

  const totalUnits = order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const pickedUnits = order?.items.reduce((sum, item) => sum + item.picked_quantity, 0) ?? 0;
  const allPicked = totalUnits > 0 && pickedUnits >= totalUnits;
  const progress = totalUnits > 0 ? Math.round((pickedUnits / totalUnits) * 100) : 0;

  useEffect(() => {
    if (!nextPendingItem) return;
    const target = itemRefs.current[nextPendingItem.id];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [nextPendingItem, pickedUnits]);

  if (loading) return <div className="text-center py-16 text-gray-500">Cargando pedido...</div>;
  if (error || !order) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="text-5xl mb-4">⚠️</div>
        <p className="text-red-700 mb-4">{error || 'Pedido no encontrado'}</p>
        <button onClick={() => navigate('/orders')} className="text-blue-700 hover:underline text-sm">
          ← Volver a pedidos
        </button>
      </div>
    );
  }

  const handleScan = async () => {
    const sku = skuInput.trim();
    if (!sku) return;

    setScanLoading(true);
    setFeedback(null);

    try {
      const result = await pickBySku(order.id, sku);
      setOrder(result.order);
      if (result.all_picked) {
        setFeedback({ type: 'success', message: '✔ Pedido listo para despacho' });
      } else {
        setFeedback({
          type: 'success',
          message: `✓ ${sku} — ${result.item_picked}/${result.item_total}`,
        });
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al escanear';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setSkuInput('');
      setScanLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleFinalize = () => {
    // Picking auto-transitions to prepared; just navigate back
    navigate('/orders');
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate('/orders')}
          className="text-gray-500 hover:text-gray-900 text-sm flex items-center gap-1"
        >
          ← Volver a pedidos
        </button>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          order.status === 'prepared' ? 'bg-green-50 text-green-700'
            : order.status === 'in_preparation' ? 'bg-blue-50 text-blue-700'
              : 'bg-yellow-50 text-yellow-800'
        }`}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">{order.order_number}</h1>
        <p className="text-sm text-gray-500">
          {order.client_name ?? `Cliente #${order.client_id}`} · {order.items.length} producto{order.items.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-900">Progreso</span>
          <span className="text-sm font-bold text-gray-900">{pickedUnits}/{totalUnits} unidades</span>
        </div>
        <div className="w-full bg-gray-50 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-300 ${allPicked ? 'bg-green-600' : 'bg-blue-600'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1.5 text-right">{progress}%</p>
      </div>

      {/* Scan input */}
      {!allPicked && (
        <div className="bg-white rounded-xl border-2 border-blue-200 p-5 mb-4">
          <label className="block text-sm font-medium text-gray-900 mb-2">
            Escanear producto (SKU)
          </label>
          <div className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleScan(); }}
              placeholder="Ingresá o escaneá el SKU..."
              disabled={scanLoading}
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3.5 text-lg font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-50"
              autoComplete="off"
            />
            <button
              onClick={handleScan}
              disabled={scanLoading || !skuInput.trim()}
              className="ui-btn-primary px-6 py-3.5 rounded-xl text-sm font-bold disabled:opacity-50 whitespace-nowrap"
            >
              {scanLoading ? '...' : 'Escanear'}
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-xl p-4 mb-4 text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {feedback.message}
        </div>
      )}

      {/* Next item */}
      {nextPendingItem && !allPicked && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Próximo a escanear</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-xs text-blue-700">SKU</p>
              <p className="font-mono text-xl font-bold text-blue-700">{nextPendingItem.sku}</p>
            </div>
            <div>
              <p className="text-xs text-blue-700">Ubicación</p>
              <p className="font-mono text-xl font-bold text-blue-700">{normalizeLocation(nextPendingItem.location_code)}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-blue-700">
            Avance del item: {nextPendingItem.picked_quantity}/{nextPendingItem.quantity}
          </p>
        </div>
      )}

      {/* Items list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-bold text-gray-900">Productos del pedido</h2>
        </div>
        <div>
          {groupedItems.map((group, groupIndex) => {
            const groupProgress = group.totalUnits > 0
              ? Math.round((group.pickedUnits / group.totalUnits) * 100)
              : 0;

            return (
              <div key={group.location} className={groupIndex > 0 ? 'border-t border-gray-200' : ''}>
                <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ubicación</p>
                      <p className="font-mono text-base font-bold text-gray-900 mt-1">{group.location}</p>
                    </div>
                    <div className="min-w-[220px]">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{group.completedItems}/{group.items.length} SKU completos</span>
                        <span>{group.pickedUnits}/{group.totalUnits} unidades</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-text-blue-700 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${groupProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-gray-100">
                  {group.items.map((item) => {
                    const done = item.picked_quantity >= item.quantity;
                    const partial = item.picked_quantity > 0 && !done;
                    const isNext = nextPendingItem?.id === item.id;

                    return (
                      <div
                        key={item.id}
                        ref={(element) => {
                          itemRefs.current[item.id] = element;
                        }}
                        className={`px-5 py-4 flex items-center gap-4 transition ${
                          done
                            ? 'bg-green-50/50'
                            : isNext
                              ? 'bg-blue-50 ring-2 ring-inset ring-blue-200'
                              : ''
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 ${
                          done ? 'bg-green-50' : isNext ? 'bg-blue-50' : partial ? 'bg-yellow-50' : 'bg-gray-50'
                        }`}>
                          {done ? '✓' : partial ? '◐' : '○'}
                        </div>

                        <div className="flex-1 min-w-0 grid gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</span>
                            {isNext && (
                              <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                                Próximo
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-base font-bold text-gray-900">{item.sku}</p>
                          <div className="grid gap-1 sm:grid-cols-2 text-sm">
                            <div>
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ubicación</span>
                              <p className="font-mono text-gray-900 mt-0.5">{normalizeLocation(item.location_code)}</p>
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Producto</span>
                              <p className="text-gray-500 mt-0.5">#{item.product_id}</p>
                            </div>
                          </div>
                        </div>

                        <div className="text-right flex-shrink-0 min-w-[72px]">
                          <span className={`text-xl font-bold ${
                            done ? 'text-green-700' : isNext ? 'text-blue-700' : partial ? 'text-yellow-800' : 'text-gray-500'
                          }`}>
                            {item.picked_quantity}
                          </span>
                          <span className="text-border text-xl">/</span>
                          <span className="text-xl font-bold text-gray-900">{item.quantity}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Finalize */}
      {allPicked && (
        <button
          onClick={handleFinalize}
          className="w-full bg-green-600 text-white py-4 rounded-xl text-lg font-bold hover:opacity-90 transition"
        >
          ✔ Pedido listo para despacho — Volver a pedidos
        </button>
      )}
    </div>
  );
}
