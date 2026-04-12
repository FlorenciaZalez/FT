import type { BatchPickingSession, BatchPickingSessionItem } from '../services/batchPicking';

export function compareBatchItems(left: BatchPickingSessionItem, right: BatchPickingSessionItem) {
  const leftLocation = left.location_codes[0] ?? '';
  const rightLocation = right.location_codes[0] ?? '';

  if (leftLocation && rightLocation) {
    const byLocation = leftLocation.localeCompare(rightLocation);
    if (byLocation !== 0) return byLocation;
  } else if (leftLocation || rightLocation) {
    return leftLocation ? -1 : 1;
  }

  return left.sku.localeCompare(right.sku);
}

export default function BatchPickingPreviewModal({
  session,
  items,
  onClose,
  onStart,
}: {
  session: BatchPickingSession;
  items: BatchPickingSessionItem[];
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-y-auto max-h-[calc(100vh-2rem)]">
        <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {session.status === 'active' ? 'Picking masivo listo' : 'Resumen de picking masivo'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Sesión #{session.id} · {items.length} SKU{items.length !== 1 ? 's' : ''} agrupado{items.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto bg-gray-50">
          {items.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-gray-500">
              No hay SKUs pendientes para esta sesión.
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="rounded-xl border border-gray-200 bg-white px-5 py-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-base font-bold text-gray-900">SKU {item.sku} - {item.product_name}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Ubicación: {item.location_codes[0] ?? 'Sin ubicación'}
                    </p>
                  </div>
                  <div className="text-sm font-semibold text-gray-900 bg-gray-50 rounded-lg px-3 py-1.5 whitespace-nowrap">
                    Cantidad: {item.quantity_total}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onStart}
            disabled={items.length === 0}
            className="ui-btn-primary px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Comenzar picking
          </button>
        </div>
      </div>
    </div>
  );
}