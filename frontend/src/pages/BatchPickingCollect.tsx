import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchBatchPickingSession, type BatchPickingSession } from '../services/batchPicking';
import { groupBatchItemsByLocation } from '../utils/batchPicking';

export default function BatchPickingCollectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<BatchPickingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchBatchPickingSession(Number(sessionId))
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar la sesión de recolección');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const groupedItems = useMemo(() => {
    if (!session) return [];
    return groupBatchItemsByLocation(session.items);
  }, [session]);

  if (loading) {
    return <div className="text-center py-16 text-gray-500">Cargando plan de recolección...</div>;
  }

  if (error || !session) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="text-5xl mb-4">⚠️</div>
        <p className="text-red-700 mb-4">{error || 'Sesión no encontrada'}</p>
        <button onClick={() => navigate('/picking')} className="text-blue-700 hover:underline text-sm">
          ← Volver a picking
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/picking')}
            className="text-gray-500 hover:text-gray-900 text-sm flex items-center gap-1 mb-3"
          >
            ← Volver a picking
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Picking masivo · Recolección</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sesión #{session.id} · Recorre el depósito por ubicación y juntá todas las unidades antes de validar.
          </p>
        </div>
        <button
          onClick={() => navigate(`/picking/batch/${session.id}/validate`)}
          className="ui-btn-primary px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap"
        >
          Ya recolecté todo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Ubicaciones" value={String(groupedItems.length)} />
        <SummaryCard label="SKUs" value={String(session.items.length)} />
        <SummaryCard label="Unidades a recolectar" value={String(session.total_units)} />
      </div>

      <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4 mb-6">
        <p className="text-sm font-semibold text-yellow-800">Etapa 1: recolección física</p>
        <p className="text-sm text-yellow-800 mt-1">
          En esta etapa no hay escaneo. Solo seguí el recorrido por ubicación y reuní todas las unidades del batch.
        </p>
      </div>

      <div className="space-y-4">
        {groupedItems.map((group) => (
          <section key={group.location} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ubicación</p>
                <h2 className="font-mono text-xl font-bold text-gray-900 mt-1">{group.location}</h2>
              </div>
              <div className="flex gap-3 text-sm">
                <span className="rounded-lg bg-white border border-gray-200 px-3 py-1.5 font-semibold text-gray-900">
                  {group.items.length} SKU{group.items.length !== 1 ? 's' : ''}
                </span>
                <span className="rounded-lg bg-white border border-gray-200 px-3 py-1.5 font-semibold text-gray-900">
                  {group.totalUnits} unidad{group.totalUnits !== 1 ? 'es' : ''}
                </span>
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {group.items.map((item) => (
                <div key={item.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</p>
                    <p className="font-mono text-lg font-bold text-gray-900 mt-1">{item.sku}</p>
                    <p className="text-sm text-gray-500 mt-1">{item.product_name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cantidad</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{item.quantity_total}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  );
}