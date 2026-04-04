import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchBatch, type DispatchBatch } from '../services/batches';
import type { Order } from '../services/orders';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  in_preparation: 'Preparando',
  prepared: 'Listo',
  dispatched: 'Despachado',
  awaiting_return: 'Esperando devolución',
  returned_pending_review: 'Pendiente de revisión',
  returned_completed: 'Devolución completada',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  dispatched: 'bg-green-50 text-green-700',
  awaiting_return: 'bg-yellow-50 text-yellow-800',
  returned_pending_review: 'bg-blue-50 text-blue-700',
  returned_completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

type BatchOrder = Order;

type BatchOperationRow = {
  key: string;
  label: string;
  primaryOrder: BatchOrder;
  deliveryOrder: BatchOrder | null;
  returnOrder: BatchOrder | null;
};

function buildBatchOperationRows(batch: DispatchBatch): BatchOperationRow[] {
  if (!batch.orders) return [];
  const rows: BatchOperationRow[] = [];
  const seenExchangeIds = new Set<string>();

  for (const order of batch.orders) {
    if (order.exchange_id) {
      if (seenExchangeIds.has(order.exchange_id)) continue;
      const grouped = batch.orders.filter((candidate) => candidate.exchange_id === order.exchange_id);
      const deliveryOrder = grouped.find((candidate) => candidate.operation_type === 'sale') ?? null;
      const returnOrder = grouped.find((candidate) => candidate.operation_type === 'return') ?? null;
      seenExchangeIds.add(order.exchange_id);
      rows.push({
        key: `exchange-${order.exchange_id}`,
        label: 'Logística inversa',
        primaryOrder: deliveryOrder ?? returnOrder ?? order,
        deliveryOrder,
        returnOrder,
      });
      continue;
    }

    rows.push({
      key: `order-${order.id}`,
      label: order.operation_type === 'return' ? 'Retiro' : 'Entrega',
      primaryOrder: order,
      deliveryOrder: order.operation_type === 'sale' ? order : null,
      returnOrder: order.operation_type === 'return' ? order : null,
    });
  }

  return rows;
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<DispatchBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    fetchBatch(Number(id))
      .then(setBatch)
      .catch(() => setError('Error al cargar el lote'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-center py-12 text-gray-500">Cargando lote...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">{error}</div>;
  if (!batch) return null;

  const operationRows = buildBatchOperationRows(batch);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/batches')}
          className="text-gray-500 hover:text-gray-500 transition"
        >
          ← Volver
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <span className="font-mono bg-gray-50 px-3 py-1 rounded text-lg">{batch.batch_number}</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1">Detalle del lote de despacho</p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Transportista</p>
          {batch.carrier ? (
            <p className="text-sm font-medium text-blue-700">🚚 {batch.carrier}</p>
          ) : (
            <p className="text-sm text-gray-500">Sin definir</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Fecha de despacho</p>
          <p className="text-sm font-medium text-gray-900">
            {new Date(batch.created_at).toLocaleDateString('es-AR', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Pedidos</p>
          <p className="text-sm font-medium text-gray-900">{batch.order_count}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Observaciones</p>
          <p className="text-sm text-gray-900">{batch.notes || '—'}</p>
        </div>
      </div>

      {/* Orders table */}
      {batch.orders && batch.orders.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">Pedidos del lote</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Nº Pedido</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Productos</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estado</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Fecha despacho</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {operationRows.map((row) => (
                <tr key={row.key} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <button
                      onClick={() => navigate(`/orders/${row.primaryOrder.id}`)}
                      className="font-medium text-blue-700 hover:text-blue-700 hover:underline"
                    >
                      {row.primaryOrder.order_number}
                    </button>
                    <div className="mt-1 text-[11px] text-gray-500">{row.label}</div>
                    {row.returnOrder && row.deliveryOrder && (
                      <div className="text-[11px] text-gray-500 font-mono">Retiro: {row.returnOrder.order_number}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-900">{row.primaryOrder.client_name ?? `#${row.primaryOrder.client_id}`}</td>
                  <td className="px-6 py-4 text-gray-500 text-xs">
                    {row.deliveryOrder && (
                      <div className="mb-1">
                        <span className="text-[11px] font-semibold text-gray-500">Entregar:</span>
                        {row.deliveryOrder.items.map((item: BatchOrder['items'][number]) => (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <span className="bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded font-mono text-xs">{item.sku}</span>
                            <span>×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {row.returnOrder && (
                      <div>
                        <span className="text-[11px] font-semibold text-gray-500">Retirar:</span>
                        {row.returnOrder.items.map((item: BatchOrder['items'][number]) => (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <span className="bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded font-mono text-xs">{item.sku}</span>
                            <span>×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      {row.deliveryOrder && (
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium w-fit ${STATUS_COLORS[row.deliveryOrder.status] ?? 'bg-gray-50 text-gray-500'}`}>
                          Entrega: {STATUS_LABELS[row.deliveryOrder.status] ?? row.deliveryOrder.status}
                        </span>
                      )}
                      {row.returnOrder && (
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium w-fit ${STATUS_COLORS[row.returnOrder.status] ?? 'bg-gray-50 text-gray-500'}`}>
                          Retiro: {STATUS_LABELS[row.returnOrder.status] ?? row.returnOrder.status}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-xs">
                    {row.primaryOrder.dispatched_at
                      ? new Date(row.primaryOrder.dispatched_at).toLocaleDateString('es-AR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => navigate(`/orders/${row.primaryOrder.id}`)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                    >
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">No se encontraron pedidos en este lote</div>
      )}
    </div>
  );
}
