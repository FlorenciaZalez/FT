import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchBatchPickingSession,
  scanBatchPickingSession,
  type BatchPickingSession,
} from '../services/batchPicking';
import { compareBatchItems, groupBatchItemsByLocation } from '../utils/batchPicking';

export default function BatchPickingSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<BatchPickingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lastScannedSku, setLastScannedSku] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});

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
        if (!cancelled) setError('No se pudo cargar la sesión de picking masivo');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!session?.is_complete) {
      inputRef.current?.focus();
    }
  }, [session, feedback]);

  const sortedItems = useMemo(() => {
    if (!session) return [];
    return [...session.items].sort(compareBatchItems);
  }, [session]);

  const groupedItems = useMemo(() => groupBatchItemsByLocation(sortedItems), [sortedItems]);

  const visibleGroupedItems = useMemo(() => {
    if (!hideCompleted) return groupedItems;
    return groupedItems
      .map((group) => {
        const items = group.items.filter((item) => !item.is_complete);
        return {
          ...group,
          items,
          totalUnits: items.reduce((sum, item) => sum + item.quantity_total, 0),
          pickedUnits: items.reduce((sum, item) => sum + item.quantity_picked, 0),
          completedItems: items.filter((item) => item.is_complete).length,
        };
      })
      .filter((group) => group.items.length > 0);
  }, [groupedItems, hideCompleted]);

  const progress = session && session.total_units > 0
    ? Math.round((session.picked_units / session.total_units) * 100)
    : 0;

  useEffect(() => {
    if (!lastScannedSku) return;
    const targetItem = sortedItems.find((item) => item.sku === lastScannedSku);
    if (!targetItem) return;
    const target = itemRefs.current[targetItem.id];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [lastScannedSku, sortedItems, session?.picked_units]);

  const handleScan = async () => {
    if (!session || !skuInput.trim() || scanLoading) return;

    setScanLoading(true);
    setFeedback(null);
    try {
      const result = await scanBatchPickingSession(session.id, skuInput.trim());
      setSession(result.session);
      setLastScannedSku(result.scanned_sku);
      setFeedback({
        type: 'success',
        message: `${result.scanned_sku} validado · ${result.item_picked}/${result.item_total}${result.sku_completed ? ' · SKU completo' : ''}${result.session_completed ? ' · Sesión completada' : ''}`,
      });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al escanear el SKU';
      setLastScannedSku(null);
      setFeedback({ type: 'error', message: msg });
    } finally {
      setSkuInput('');
      setScanLoading(false);
      inputRef.current?.focus();
    }
  };

  if (loading) {
    return <div className="text-center py-16 text-gray-500">Cargando picking masivo...</div>;
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
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
        <div>
          <button
            onClick={() => navigate(`/picking/batch/${session.id}`)}
            className="text-gray-500 hover:text-gray-900 text-sm flex items-center gap-1 mb-3"
          >
            ← Volver a recolección
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Picking masivo · Validación</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sesión #{session.id} · Operador: {session.user_name ?? 'Sin asignar'}
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl text-sm font-bold ${session.is_complete ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
          {session.is_complete ? 'Sesión completada' : 'Sesión activa'}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Unidades totales" value={String(session.total_units)} />
        <SummaryCard label="Unidades validadas" value={String(session.picked_units)} />
        <SummaryCard label="SKUs pendientes" value={String(sortedItems.filter((item) => !item.is_complete).length)} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-900">Progreso general</span>
          <span className="text-sm font-bold text-gray-900">{session.picked_units}/{session.total_units}</span>
        </div>
        <div className="w-full bg-gray-50 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-300 ${session.is_complete ? 'bg-green-600' : 'bg-blue-600'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1.5 text-right">{progress}%</p>
      </div>

      {!session.is_complete && (
        <>
          <div className="bg-white rounded-xl border-2 border-blue-200 p-5 mb-6">
            <label className="block text-sm font-medium text-gray-900 mb-2">Escanear SKU</label>
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

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Validación por escaneo</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Escaneá los SKU recolectados. El sistema valida contra la sesión activa y descuenta las unidades pendientes.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-500">
                <input
                  type="checkbox"
                  checked={hideCompleted}
                  onChange={(e) => setHideCompleted(e.target.checked)}
                  className="rounded border-gray-200 text-blue-700 focus:ring-blue-500"
                />
                Ocultar completos
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MiniStat label="SKU activos" value={String(sortedItems.filter((item) => !item.is_complete).length)} />
              <MiniStat label="SKU completos" value={String(sortedItems.filter((item) => item.is_complete).length)} />
              <MiniStat label="Unidades restantes" value={String(session.total_units - session.picked_units)} />
            </div>
          </div>
        </>
      )}

      {session.is_complete && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 mb-6">
          <p className="text-green-700 font-semibold">Todos los SKUs quedaron completos.</p>
          <p className="text-green-700 text-sm mt-1">Los pedidos asociados ya quedaron listos para despacho según su avance.</p>
        </div>
      )}

      <div className="space-y-4">
        {visibleGroupedItems.map((group) => {
          const groupProgress = group.totalUnits > 0 ? Math.round((group.pickedUnits / group.totalUnits) * 100) : 0;
          return (
            <section key={group.location} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ubicación</p>
                  <h2 className="font-mono text-xl font-bold text-gray-900 mt-1">{group.location}</h2>
                </div>
                <div className="min-w-[240px]">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>{group.completedItems}/{group.items.length} SKU completos</span>
                    <span>{group.pickedUnits}/{group.totalUnits} unidades</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-text-blue-700 h-2 rounded-full transition-all" style={{ width: `${groupProgress}%` }} />
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {group.items.map((item) => {
                  const itemProgress = item.quantity_total > 0
                    ? Math.round((item.quantity_picked / item.quantity_total) * 100)
                    : 0;
                  const remaining = item.quantity_total - item.quantity_picked;
                  const isLastScanned = lastScannedSku?.trim().toLowerCase() === item.sku.trim().toLowerCase();

                  return (
                    <div
                      key={item.id}
                      ref={(element) => {
                        itemRefs.current[item.id] = element;
                      }}
                      className={`px-6 py-5 transition ${
                        item.is_complete
                          ? 'bg-green-50/40'
                          : isLastScanned
                            ? 'bg-blue-50 ring-2 ring-inset ring-blue-200'
                            : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${item.is_complete ? 'bg-green-50 text-green-700' : isLastScanned ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500'}`}>
                          {item.is_complete ? '✓' : '○'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div>
                              <h3 className="text-base font-bold text-gray-900">{item.product_name}</h3>
                              <p className="font-mono text-sm text-gray-900 mt-1">SKU: {item.sku}</p>
                              {isLastScanned && (
                                <span className="inline-flex mt-2 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700">
                                  Último escaneado
                                </span>
                              )}
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${item.is_complete ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-900'}`}>
                              {item.is_complete ? 'Completo' : `${remaining} pendiente${remaining !== 1 ? 's' : ''}`}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-3">
                            <div>
                              <p className="text-gray-500">Cantidad total</p>
                              <p className="font-bold text-gray-900 mt-1">{item.quantity_total}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Validado</p>
                              <p className="font-bold text-gray-900 mt-1">{item.quantity_picked}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Pendiente</p>
                              <p className="font-bold text-gray-900 mt-1">{remaining}</p>
                            </div>
                          </div>

                          <div className="w-full bg-gray-50 rounded-full h-2.5 mb-3">
                            <div
                              className={`h-2.5 rounded-full transition-all ${item.is_complete ? 'bg-green-600' : isLastScanned ? 'bg-blue-600' : 'bg-text-secondary'}`}
                              style={{ width: `${itemProgress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
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