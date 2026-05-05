import { useState, useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStock } from '../hooks/useStock';
import { useAuth } from '../auth/AuthContext';
import { fetchProducts, type Product } from '../services/products';
import { fetchStockMovements, fetchMovementsByProduct, stockIn as createStockInbound, type StockMovement, type StockItem } from '../services/stock';
import { fetchClients, type Client } from '../services/clients';
import {
  createMerchandiseReceptionRecord,
  deleteMerchandiseReceptionRecord,
  fetchGlobalBillingRates,
  fetchMerchandiseReceptionRecords,
  type MerchandiseReceptionRecord,
} from '../services/billing';
import { generateLabelsPDF, generateLabelsPDFByItems } from '../utils/labels';
import { formatNumber, getCurrentPeriod, toFiniteNumber } from '../utils/billingFormat';
import SuccessToast from '../components/SuccessToast';

const REASON_OPTIONS_IN = [
  'Ingreso inicial',
  'Reposición',
  'Devolución',
  'Ajuste',
] as const;

const REASON_OPTIONS_OUT = [
  'Venta',
  'Daño',
  'Ajuste',
  'Devolución',
] as const;

function formatMovementDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `Hoy ${time}`;
  if (diffDays === 1) return `Ayer ${time}`;
  return `${d.toLocaleDateString('es-AR')} ${time}`;
}

function isLowStock(item: Pick<StockItem, 'quantity_available' | 'min_stock_alert'> | null | undefined): boolean {
  if (!item) return false;
  return item.quantity_available > 0 && item.quantity_available <= item.min_stock_alert;
}

function normalizeSku(value: string): string {
  return value.trim().toLowerCase();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
}

type BulkStockRowStatus = 'idle' | 'matched' | 'error' | 'success';

type BulkStockRow = {
  id: number;
  sku: string;
  clientId: number | null;
  clientName: string;
  productId: number | null;
  productName: string;
  quantity: string;
  printLabels: boolean;
  printQuantity: string;
  error: string;
  status: BulkStockRowStatus;
};

let bulkRowSequence = 1;

function createEmptyBulkRow(): BulkStockRow {
  const nextId = bulkRowSequence;
  bulkRowSequence += 1;
  return {
    id: nextId,
    sku: '',
    clientId: null,
    clientName: '',
    productId: null,
    productName: '',
    quantity: '1',
    printLabels: false,
    printQuantity: '1',
    error: '',
    status: 'idle',
  };
}

function hasBulkRowContent(row: BulkStockRow): boolean {
  return row.sku.trim().length > 0 || row.productId !== null || row.quantity.trim() !== '1';
}

function getProductSearchRank(product: Product, query: string): number {
  const sku = normalizeSku(product.sku);
  const name = product.name.trim().toLowerCase();
  if (sku === query) return 0;
  if (sku.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  if (sku.includes(query)) return 3;
  return 4;
}

export default function StockPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isClient = user?.role === 'client';
  const [searchParams, setSearchParams] = useSearchParams();
  const searchFilter = searchParams.get('search') ?? '';
  const clientFilter = searchParams.get('clientId') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const stockFilters = useMemo(() => ({
    search: searchFilter,
    clientId: clientFilter ? Number(clientFilter) : null,
    status: statusFilter as 'available' | 'out_of_stock' | 'low_stock' | '',
  }), [searchFilter, clientFilter, statusFilter]);
  const { items, loading, error, addStock, removeStock, reload } = useStock(stockFilters);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [showInModal, setShowInModal] = useState(false);
  const [showOutModal, setShowOutModal] = useState(false);
  const [showBulkEntry, setShowBulkEntry] = useState(false);
  const [preselectedProductId, setPreselectedProductId] = useState<number | null>(null);
  const [historyProductId, setHistoryProductId] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [receptionPeriod, setReceptionPeriod] = useState(getCurrentPeriod());
  const [showReceptionOverviewModal, setShowReceptionOverviewModal] = useState(false);
  const [showReceptionModal, setShowReceptionModal] = useState(false);
  const [receptionRecords, setReceptionRecords] = useState<MerchandiseReceptionRecord[]>([]);
  const [receptionFee, setReceptionFee] = useState(0);
  const [receptionLoading, setReceptionLoading] = useState(false);
  const [receptionError, setReceptionError] = useState('');
  const [savingReception, setSavingReception] = useState(false);
  const [deletingReceptionId, setDeletingReceptionId] = useState<number | null>(null);
  const [receptionForm, setReceptionForm] = useState({
    client_id: '',
    fecha: new Date().toISOString().slice(0, 10),
    cantidad_camiones: '1',
    observaciones: '',
  });

  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => {});
    if (!isClient) {
      fetchClients().then(setClients).catch(() => {});
      fetchStockMovements().then(setMovements).catch(() => {});
    } else {
      setMovements([]);
    }
  }, [isClient]);

  useEffect(() => {
    if (!isAdmin) return;

    const selectedClientId = clientFilter ? Number(clientFilter) : undefined;
    setReceptionLoading(true);
    setReceptionError('');

    Promise.all([
      fetchGlobalBillingRates(),
      fetchMerchandiseReceptionRecords({
        period: receptionPeriod,
        client_id: Number.isInteger(selectedClientId) ? selectedClientId : undefined,
      }),
    ])
      .then(([rates, records]) => {
        setReceptionFee(toFiniteNumber(rates.truck_unloading_fee));
        setReceptionRecords(records);
      })
      .catch(() => {
        setReceptionError('No se pudo cargar la recepción de mercadería.');
      })
      .finally(() => {
        setReceptionLoading(false);
      });
  }, [isAdmin, receptionPeriod, clientFilter]);

  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const lastMovementByProduct = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of movements) {
      if (!map.has(m.product_id)) {
        map.set(m.product_id, m.created_at);
      }
    }
    return map;
  }, [movements]);

  const stockMap = useMemo(() => {
    const map = new Map<number, StockItem>();
    for (const s of items) map.set(s.product_id, s);
    return map;
  }, [items]);

  const handleSuccess = (msg: string) => {
    setSuccessMsg(msg);
    fetchStockMovements().then(setMovements).catch(() => {});
  };

  const reloadReceptionRecords = async () => {
    if (!isAdmin) return;
    const selectedClientId = clientFilter ? Number(clientFilter) : undefined;
    setReceptionLoading(true);
    setReceptionError('');
    try {
      const records = await fetchMerchandiseReceptionRecords({
        period: receptionPeriod,
        client_id: Number.isInteger(selectedClientId) ? selectedClientId : undefined,
      });
      setReceptionRecords(records);
    } catch {
      setReceptionError('No se pudo cargar la recepción de mercadería.');
    } finally {
      setReceptionLoading(false);
    }
  };

  const handleCreateReception = async (event: FormEvent) => {
    event.preventDefault();
    const clientId = Number(receptionForm.client_id);
    const cantidadCamiones = Number(receptionForm.cantidad_camiones);
    const observaciones = receptionForm.observaciones.trim();

    if (!Number.isInteger(clientId) || clientId <= 0 || !receptionForm.fecha || !Number.isInteger(cantidadCamiones) || cantidadCamiones <= 0) {
      setReceptionError('Completá cliente, fecha y una cantidad de camiones válida.');
      return;
    }

    setSavingReception(true);
    setReceptionError('');
    try {
      await createMerchandiseReceptionRecord({
        client_id: clientId,
        fecha: receptionForm.fecha,
        cantidad_camiones: cantidadCamiones,
        observaciones: observaciones || undefined,
      });
      setShowReceptionModal(false);
      setReceptionForm({
        client_id: '',
        fecha: new Date().toISOString().slice(0, 10),
        cantidad_camiones: '1',
        observaciones: '',
      });
      await reloadReceptionRecords();
      handleSuccess('Recepción de mercadería registrada.');
    } catch (error: unknown) {
      setReceptionError(getApiErrorMessage(error, 'No se pudo registrar la recepción de mercadería.'));
    } finally {
      setSavingReception(false);
    }
  };

  const handleDeleteReception = async (recordId: number) => {
    setDeletingReceptionId(recordId);
    setReceptionError('');
    try {
      await deleteMerchandiseReceptionRecord(recordId);
      await reloadReceptionRecords();
      handleSuccess('Recepción de mercadería eliminada.');
    } catch (error: unknown) {
      setReceptionError(getApiErrorMessage(error, 'No se pudo eliminar la recepción de mercadería.'));
    } finally {
      setDeletingReceptionId(null);
    }
  };

  const openInModal = (productId?: number) => {
    setPreselectedProductId(productId ?? null);
    setShowInModal(true);
  };

  const openOutModal = (productId?: number) => {
    setPreselectedProductId(productId ?? null);
    setShowOutModal(true);
  };

  const hasActiveFilters = Boolean(searchFilter.trim() || clientFilter || statusFilter);
  const receptionTruckCount = useMemo(
    () => receptionRecords.reduce((acc, record) => acc + Math.max(0, Math.trunc(toFiniteNumber(record.cantidad_camiones))), 0),
    [receptionRecords],
  );
  const receptionTotal = useMemo(
    () => receptionRecords.reduce((acc, record) => acc + toFiniteNumber(record.costo_total), 0),
    [receptionRecords],
  );

  const updateParam = (key: 'search' | 'clientId' | 'status', value: string) => {
    const next = new URLSearchParams(searchParams);
    const normalized = key === 'search' ? value.trim() : value;
    if (normalized) next.set(key, normalized);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const historyProduct = products.find((p) => p.id === historyProductId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isClient
              ? 'Vista de stock en tiempo real. Solo lectura para seguimiento del cliente.'
              : 'Stock actual por producto. Los cambios se realizan mediante movimientos.'}
          </p>
        </div>
        {!isClient && (
          <div className="flex gap-3">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowReceptionOverviewModal(true)}
              className="px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-medium transition hover:bg-blue-100"
            >
              Recepción de mercadería
            </button>
          )}
          <button
            onClick={() => setShowBulkEntry((current) => !current)}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition flex items-center gap-1.5 ${
              showBulkEntry
                ? 'border-gray-900 bg-gray-900 text-white hover:opacity-90'
                : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span className="text-base leading-none">≣</span>
            {showBulkEntry ? 'Ocultar ingreso masivo' : 'Ingreso masivo'}
          </button>
          <button
            onClick={() => openInModal()}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center gap-1.5"
          >
            <span className="text-lg leading-none">+</span> Ingresar stock
          </button>
          <button
            onClick={() => openOutModal()}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center gap-1.5"
          >
            <span className="text-lg leading-none">&minus;</span> Retirar stock
          </button>
          </div>
        )}
      </div>

      {/* Success message */}
      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          {error}
        </div>
      )}

      {successMsg && <SuccessToast message={successMsg} onClose={() => setSuccessMsg('')} />}

      {!isClient && showBulkEntry && (
        <BulkStockEntryPanel
          products={products}
          clients={clients}
          onClose={() => setShowBulkEntry(false)}
          onCompleted={async (summary) => {
            await reload();
            fetchStockMovements().then(setMovements).catch(() => {});
            handleSuccess(summary);
          }}
        />
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Buscar</label>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => updateParam('search', e.target.value)}
              placeholder="Buscar por SKU o nombre..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {!isClient && (
          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Cliente</label>
            <select
              value={clientFilter}
              onChange={(e) => updateParam('clientId', e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Todos los clientes</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
          )}
          <div className="min-w-[190px]">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1.5">Estado</label>
            <select
              value={statusFilter}
              onChange={(e) => updateParam('status', e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Todos</option>
              <option value="available">Disponible</option>
              <option value="out_of_stock">Sin stock</option>
              <option value="low_stock">Stock bajo</option>
            </select>
          </div>
          <button
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando stock...</div>
      ) : items.length === 0 && !hasActiveFilters ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">No hay stock registrado</p>
          {!isClient && (
            <p className="text-gray-500 text-sm">
              Usá el botón <strong>"+ Ingresar stock"</strong> para agregar mercadería.
            </p>
          )}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">No hay resultados para esos filtros</p>
          <p className="text-gray-500 text-sm">Probá con otro cliente, otro estado o una búsqueda distinta.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-auto flex-1 min-h-0 table-scroll-container">
          <table className="w-full min-w-[1020px] text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">SKU</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Total</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Reservado</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Disponible</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estado</th>
                {!isClient && <th className="text-left px-6 py-3 font-medium text-gray-500">Último movimiento</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const avail = s.quantity_available;
                const isZero = avail === 0;
                const isLow = isLowStock(s);
                return (
                  <tr
                    key={s.product_id}
                    onClick={() => setSelectedProductId(s.product_id)}
                    className={`border-b border-gray-200 cursor-pointer ${
                      isZero
                        ? 'bg-red-50 hover:bg-red-100'
                        : isLow
                          ? 'bg-yellow-50 hover:bg-yellow-100'
                          : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-6 py-4 font-medium text-gray-900">{s.product_name}</td>
                    <td className="px-6 py-4">
                      <span className="bg-gray-50 text-gray-900 px-2 py-0.5 rounded font-mono text-xs">
                        {s.sku}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">{s.client_name}</td>
                    <td className="px-6 py-4 text-right tabular-nums font-medium text-gray-900">
                      {s.quantity_total}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums">
                      {s.quantity_reserved > 0 ? (
                        <span className="text-blue-700 font-medium">{s.quantity_reserved}</span>
                      ) : (
                        <span className="text-gray-500">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums font-bold text-gray-900">
                      <span>{avail}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                          isZero
                            ? 'bg-red-100 text-red-700'
                            : isLow
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {isZero ? 'Sin stock' : isLow ? 'Bajo' : 'Disponible'}
                      </span>
                    </td>
                    {!isClient && (
                      <td className="px-6 py-4 text-gray-500 text-sm">
                        {lastMovementByProduct.has(s.product_id)
                          ? formatMovementDate(lastMovementByProduct.get(s.product_id)!)
                          : 'Sin movimiento'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock In Modal */}
      {showInModal && (
        <StockMoveModal
          type="in"
          products={products}
          clients={clients}
          stockMap={stockMap}
          clientMap={clientMap}
          preselectedProductId={preselectedProductId}
          onClose={() => setShowInModal(false)}
          onSubmit={async (productId, quantity, reason, notes, labelOptions) => {
            const fullReason = notes ? `${reason} — ${notes}` : reason;
            const result = await addStock({ product_id: productId, quantity, reason: fullReason || undefined });
            let summary = `Ingreso exitoso: +${quantity} unidades de "${result.product_name}" (stock actual: ${result.new_quantity})`;

            if (labelOptions?.enabled) {
              try {
                await generateLabelsPDF(
                  [{ name: result.product_name, sku: result.sku }],
                  labelOptions.quantity,
                );
                summary += ` + ${labelOptions.quantity} etiqueta${labelOptions.quantity !== 1 ? 's' : ''} generada${labelOptions.quantity !== 1 ? 's' : ''}`;
              } catch {
                summary += '. El ingreso se procesó, pero no se pudieron generar las etiquetas';
              }
            }

            handleSuccess(
              summary,
            );
            setShowInModal(false);
          }}
        />
      )}

      {/* Stock Out Modal */}
      {showOutModal && (
        <StockMoveModal
          type="out"
          products={products}
          clients={clients}
          stockMap={stockMap}
          clientMap={clientMap}
          preselectedProductId={preselectedProductId}
          onClose={() => setShowOutModal(false)}
          onSubmit={async (productId, quantity, reason, notes) => {
            const fullReason = notes ? `${reason} — ${notes}` : reason;
            const result = await removeStock({ product_id: productId, quantity, reason: fullReason || undefined });
            handleSuccess(
              `Egreso exitoso: -${quantity} unidades de "${result.product_name}" (stock actual: ${result.new_quantity})`
            );
            setShowOutModal(false);
          }}
        />
      )}

      {showReceptionModal && (
        <MerchandiseReceptionModal
          clients={clients.filter((client) => client.is_active)}
          form={receptionForm}
          saving={savingReception}
          onClose={() => setShowReceptionModal(false)}
          onChange={(field, value) => {
            setReceptionForm((current) => ({ ...current, [field]: value }));
          }}
          onSubmit={handleCreateReception}
        />
      )}

      {showReceptionOverviewModal && (
        <MerchandiseReceptionOverviewModal
          period={receptionPeriod}
          onPeriodChange={setReceptionPeriod}
          receptionFee={receptionFee}
          receptionTruckCount={receptionTruckCount}
          receptionTotal={receptionTotal}
          loading={receptionLoading}
          error={receptionError}
          records={receptionRecords}
          deletingReceptionId={deletingReceptionId}
          clientFilter={clientFilter}
          onClose={() => setShowReceptionOverviewModal(false)}
          onOpenCreate={() => {
            setShowReceptionOverviewModal(false);
            setShowReceptionModal(true);
          }}
          onDelete={(recordId) => {
            handleDeleteReception(recordId).catch(() => {});
          }}
        />
      )}

      {/* History Modal */}
      {!isClient && historyProductId !== null && historyProduct && (
        <MovementHistoryModal
          product={historyProduct}
          clientName={clientMap.get(historyProduct.client_id) ?? '—'}
          stockEntry={stockMap.get(historyProductId) ?? null}
          onClose={() => setHistoryProductId(null)}
        />
      )}

      {/* Product Detail Modal (from row click) */}
      {selectedProductId !== null && (() => {
        const product = products.find((p) => p.id === selectedProductId);
        const stock = stockMap.get(selectedProductId);
        if (!product) return null;
        const avail = stock?.quantity_available ?? 0;
        const isZero = avail === 0;
        const isLow = isLowStock(stock);
        return (
          <div className="app-modal-overlay bg-text-blue-700/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{product.name}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    <span className="bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded font-mono text-xs">{product.sku}</span>
                    {' · '}{clientMap.get(product.client_id) ?? '—'}
                  </p>
                </div>
                <button onClick={() => setSelectedProductId(null)} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 space-y-3 mb-5">
                <div className="flex gap-6 text-sm">
                  <div>
                    <span className="text-gray-500">Total:</span>{' '}
                    <span className="font-bold text-gray-900">{stock?.quantity_total ?? 0}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Reservado:</span>{' '}
                    <span className={`font-bold ${(stock?.quantity_reserved ?? 0) > 0 ? 'text-blue-700' : 'text-gray-500'}`}>
                      {stock?.quantity_reserved ?? 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Disponible:</span>{' '}
                    <span className={`font-bold ${
                      isZero ? 'text-red-700' : isLow ? 'text-yellow-800' : 'text-green-700'
                    }`}>
                      {avail}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                      isZero ? 'bg-red-100 text-red-700' : isLow ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {isZero ? 'Sin stock' : isLow ? 'Stock bajo' : 'Disponible'}
                  </span>
                  {!isClient && (
                    <span className="text-xs text-gray-500">
                      Último mov: {lastMovementByProduct.has(selectedProductId)
                        ? formatMovementDate(lastMovementByProduct.get(selectedProductId)!)
                        : 'Sin movimiento'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                {!isClient && (
                  <>
                    <button
                      onClick={() => { setSelectedProductId(null); openInModal(selectedProductId); }}
                      className="flex-1 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1.5"
                    >
                      <span className="text-lg leading-none">+</span> Ingresar
                    </button>
                    <button
                      onClick={() => { setSelectedProductId(null); openOutModal(selectedProductId); }}
                      className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1.5"
                    >
                      <span className="text-lg leading-none">&minus;</span> Retirar
                    </button>
                  </>
                )}
                {!isClient && (
                  <button
                    onClick={() => { setSelectedProductId(null); setHistoryProductId(selectedProductId); }}
                    className="flex-1 border border-gray-200 text-gray-900 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
                  >
                    Historial
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
    fallback
  );
}

function MerchandiseReceptionOverviewModal({
  period,
  onPeriodChange,
  receptionFee,
  receptionTruckCount,
  receptionTotal,
  loading,
  error,
  records,
  deletingReceptionId,
  clientFilter,
  onClose,
  onOpenCreate,
  onDelete,
}: {
  period: string;
  onPeriodChange: (value: string) => void;
  receptionFee: number;
  receptionTruckCount: number;
  receptionTotal: number;
  loading: boolean;
  error: string;
  records: MerchandiseReceptionRecord[];
  deletingReceptionId: number | null;
  clientFilter: string;
  onClose: () => void;
  onOpenCreate: () => void;
  onDelete: (recordId: number) => void;
}) {
  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[86vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Recepción de mercadería</h2>
            <p className="text-sm text-gray-500 mt-1">Registrá descargas operativas del depósito. El cargo se refleja después en Facturación.</p>
            <div className="mt-2 text-sm text-gray-600">
              Tarifa: <span className="font-medium text-gray-900">{formatCurrency(receptionFee)}</span> por camión
              <span className="mx-2 text-gray-400">•</span>
              Camiones: <span className="font-medium text-gray-900">{formatNumber(receptionTruckCount, 0)}</span>
              <span className="mx-2 text-gray-400">•</span>
              Total: <span className="font-medium text-gray-900">{formatCurrency(receptionTotal)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col justify-end">
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Período</label>
              <input
                type="month"
                value={period}
                onChange={(event) => onPeriodChange(event.target.value)}
                className="h-[42px] px-4 py-2.5 border border-gray-200 rounded-lg bg-white"
              />
            </div>
            <button
              type="button"
              onClick={onOpenCreate}
              className="h-[42px] bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition"
            >
              + Registrar recepción
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-[42px] px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cerrar
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 p-6 pt-4 overflow-auto">
          {loading ? (
            <div className="py-6 text-sm text-gray-500">Cargando recepciones...</div>
          ) : records.length === 0 ? (
            <div className="py-6 text-sm text-gray-500">
              No hay recepciones cargadas para {period}{clientFilter ? ' con el cliente seleccionado' : ''}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Fecha</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Camiones</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Observaciones</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Costo</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-b border-gray-200 last:border-b-0">
                      <td className="px-6 py-4 font-medium text-gray-900">{record.client_name ?? `Cliente #${record.client_id}`}</td>
                      <td className="px-4 py-4 text-gray-500">{new Date(record.fecha).toLocaleDateString('es-AR')}</td>
                      <td className="px-4 py-4 text-right text-gray-500">{formatNumber(record.cantidad_camiones, 0)}</td>
                      <td className="px-4 py-4 text-gray-900">{record.observaciones || 'Sin observaciones'}</td>
                      <td className="px-4 py-4 text-right font-medium text-gray-900">{formatCurrency(record.costo_total)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => onDelete(record.id)}
                          disabled={deletingReceptionId === record.id}
                          className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition disabled:opacity-50"
                        >
                          {deletingReceptionId === record.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MerchandiseReceptionModal({
  clients,
  form,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  clients: Client[];
  form: {
    client_id: string;
    fecha: string;
    cantidad_camiones: string;
    observaciones: string;
  };
  saving: boolean;
  onClose: () => void;
  onChange: (field: 'client_id' | 'fecha' | 'cantidad_camiones' | 'observaciones', value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[560px] overflow-y-auto max-h-[calc(100vh-2rem)]">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Registrar recepción</h2>
            <p className="text-sm text-gray-500 mt-1">Cada recepción genera un cargo único por descarga de camión para el cliente.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <form onSubmit={(event) => { onSubmit(event).catch(() => {}); }} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Cliente</label>
            <select
              value={form.client_id}
              onChange={(e) => onChange('client_id', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white"
            >
              <option value="">Seleccionar cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Fecha</label>
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => onChange('fecha', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Cantidad de camiones</label>
              <input
                type="number"
                min={1}
                value={form.cantidad_camiones}
                onChange={(e) => onChange('cantidad_camiones', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Observaciones</label>
            <input
              type="text"
              value={form.observaciones}
              onChange={(e) => onChange('observaciones', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
              placeholder="Opcional"
            />
          </div>

          <div className="pt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? 'Guardando...' : 'Confirmar recepción'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkStockEntryPanel({
  products,
  clients,
  onClose,
  onCompleted,
}: {
  products: Product[];
  clients: Client[];
  onClose: () => void;
  onCompleted: (summary: string) => Promise<void>;
}) {
  const [initialRow] = useState<BulkStockRow>(() => createEmptyBulkRow());
  const [rows, setRows] = useState<BulkStockRow[]>(() => [initialRow]);
  const [submitting, setSubmitting] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [debouncedQueries, setDebouncedQueries] = useState<Record<number, string>>({
    [initialRow.id]: initialRow.sku,
  });
  const [openDropdownRowId, setOpenDropdownRowId] = useState<number | null>(null);
  const [highlightedIndexByRow, setHighlightedIndexByRow] = useState<Record<number, number>>({});
  const [focusRowId, setFocusRowId] = useState<number | null>(null);
  const searchInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const selectableProducts = useMemo(
    () => [...products].sort((left, right) => {
      if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
      return left.name.localeCompare(right.name, 'es');
    }),
    [products],
  );
  const clientNameById = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients],
  );
  const productMatchesBySku = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of selectableProducts) {
      const key = normalizeSku(product.sku);
      const current = map.get(key) ?? [];
      current.push(product);
      map.set(key, current);
    }
    return map;
  }, [selectableProducts]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQueries(
        Object.fromEntries(rows.map((row) => [row.id, row.sku])) as Record<number, string>,
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [rows]);

  useEffect(() => {
    if (focusRowId === null) return;
    const input = searchInputRefs.current[focusRowId];
    if (!input) return;
    const frame = requestAnimationFrame(() => {
      input.focus();
      input.select();
      setFocusRowId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRowId, rows]);

  const searchMatchesByRow = useMemo(() => {
    const entries: Array<[number, Product[]]> = rows.map((row) => {
      const query = normalizeSku(debouncedQueries[row.id] ?? '');
      if (!query) return [row.id, []];

      const matches = selectableProducts
        .filter((product) => {
          const sku = normalizeSku(product.sku);
          const name = product.name.trim().toLowerCase();
          return sku.includes(query) || name.includes(query);
        })
        .sort((left, right) => {
          const rankDiff = getProductSearchRank(left, query) - getProductSearchRank(right, query);
          if (rankDiff !== 0) return rankDiff;
          return left.name.localeCompare(right.name, 'es');
        })
        .slice(0, 8);

      return [row.id, matches];
    });

    return new Map<number, Product[]>(entries);
  }, [selectableProducts, debouncedQueries, rows]);

  const buildRowFromProduct = (row: BulkStockRow, product: Product): BulkStockRow => ({
    ...row,
    sku: product.sku,
    clientId: product.client_id,
    clientName: clientNameById.get(product.client_id) ?? '—',
    productId: product.id,
    productName: product.name,
    error: '',
    status: 'matched',
  });

  const getExactSkuMatch = (query: string): Product | null => {
    const normalized = normalizeSku(query);
    if (!normalized) return null;
    const matches = productMatchesBySku.get(normalized) ?? [];
    return matches.length === 1 ? matches[0] : null;
  };

  const resolveRowFromSku = (row: BulkStockRow, rawSku: string): BulkStockRow => {
    const normalized = normalizeSku(rawSku);
    if (!normalized) {
      return {
        ...row,
        sku: rawSku,
        clientId: null,
        clientName: '',
        productId: null,
        productName: '',
        printLabels: row.printLabels,
        printQuantity: row.printQuantity,
        error: '',
        status: 'idle',
      };
    }

    const exactMatch = getExactSkuMatch(rawSku);
    if (exactMatch) {
      return buildRowFromProduct(row, exactMatch);
    }

    const exactDuplicateMatches = productMatchesBySku.get(normalized) ?? [];
    if (exactDuplicateMatches.length > 1) {
      return {
        ...row,
        sku: rawSku,
        clientId: null,
        clientName: '',
        productId: null,
        productName: '',
        printLabels: row.printLabels,
        printQuantity: row.printQuantity,
        error: 'SKU duplicado',
        status: 'error',
      };
    }

    return {
      ...row,
      sku: rawSku,
      clientId: null,
      clientName: '',
      productId: null,
      productName: '',
      printLabels: row.printLabels,
      printQuantity: row.printQuantity,
      error: '',
      status: 'idle',
    };
  };

  const updateRow = (rowId: number, updater: (row: BulkStockRow) => BulkStockRow) => {
    setRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)));
  };

  const appendRow = (afterRowId?: number) => {
    const nextRow = createEmptyBulkRow();
    setRows((current) => {
      if (afterRowId === undefined) return [...current, nextRow];
      const index = current.findIndex((row) => row.id === afterRowId);
      if (index === -1) return [...current, nextRow];
      return [...current.slice(0, index + 1), nextRow, ...current.slice(index + 1)];
    });
    setOpenDropdownRowId(null);
    setHighlightedIndexByRow((current) => ({ ...current, [nextRow.id]: 0 }));
    setFocusRowId(nextRow.id);
  };

  const removeRow = (rowId: number) => {
    setRows((current) => {
      if (current.length === 1) {
        return [createEmptyBulkRow()];
      }
      return current.filter((row) => row.id !== rowId);
    });
    setOpenDropdownRowId((current) => (current === rowId ? null : current));
  };

  const handleSkuChange = (rowId: number, value: string) => {
    setPanelError('');
    updateRow(rowId, (row) => resolveRowFromSku({ ...row, status: 'idle', error: '' }, value));
    setOpenDropdownRowId(value.trim() ? rowId : null);
    setHighlightedIndexByRow((current) => ({ ...current, [rowId]: 0 }));
  };

  const selectSearchMatch = (rowId: number, product: Product, advance = false) => {
    const currentRow = rows.find((row) => row.id === rowId);
    if (!currentRow) return;
    const nextRow = buildRowFromProduct(currentRow, product);
    updateRow(rowId, () => nextRow);
    setOpenDropdownRowId(null);
    if (advance) {
      const quantity = parseInt(nextRow.quantity, 10);
      if (!Number.isNaN(quantity) && quantity > 0) {
        appendRow(rowId);
      }
    }
  };

  const handleQuantityChange = (rowId: number, value: string) => {
    setPanelError('');
    updateRow(rowId, (row) => ({
      ...row,
      quantity: value,
      printQuantity:
        row.printLabels && (row.printQuantity.trim() === '' || row.printQuantity === row.quantity)
          ? value
          : row.printQuantity,
      error: row.error === 'Cantidad inválida' ? '' : row.error,
      status: row.status === 'error' && row.error === 'Cantidad inválida' ? 'matched' : row.status,
    }));
  };

  const handlePrintToggle = (rowId: number, checked: boolean) => {
    setPanelError('');
    updateRow(rowId, (row) => ({
      ...row,
      printLabels: checked,
      printQuantity: checked ? (row.quantity.trim() || '1') : row.printQuantity,
      error: row.error === 'Cantidad de etiquetas inválida' ? '' : row.error,
      status:
        row.status === 'error' && row.error === 'Cantidad de etiquetas inválida'
          ? 'matched'
          : row.status,
    }));
  };

  const handlePrintQuantityChange = (rowId: number, value: string) => {
    setPanelError('');
    updateRow(rowId, (row) => ({
      ...row,
      printQuantity: value,
      error: row.error === 'Cantidad de etiquetas inválida' ? '' : row.error,
      status:
        row.status === 'error' && row.error === 'Cantidad de etiquetas inválida'
          ? 'matched'
          : row.status,
    }));
  };

  const handleRowAdvance = (rowId: number) => {
    const row = rows.find((current) => current.id === rowId);
    if (!row) return;
    const quantity = parseInt(row.quantity, 10);
    if (!row.productId) {
      updateRow(rowId, (current) => ({ ...current, error: current.error || 'Producto no encontrado', status: 'error' }));
      return;
    }
    if (Number.isNaN(quantity) || quantity <= 0) {
      updateRow(rowId, (current) => ({ ...current, error: 'Cantidad inválida', status: 'error' }));
      return;
    }
    appendRow(rowId);
  };

  const handleSkuKeyDown = (rowId: number, event: KeyboardEvent<HTMLInputElement>) => {
    const matches = searchMatchesByRow.get(rowId) ?? [];
    const highlightedIndex = highlightedIndexByRow[rowId] ?? 0;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (matches.length === 0) return;
      setOpenDropdownRowId(rowId);
      setHighlightedIndexByRow((current) => ({
        ...current,
        [rowId]: highlightedIndex >= matches.length - 1 ? 0 : highlightedIndex + 1,
      }));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length === 0) return;
      setOpenDropdownRowId(rowId);
      setHighlightedIndexByRow((current) => ({
        ...current,
        [rowId]: highlightedIndex <= 0 ? matches.length - 1 : highlightedIndex - 1,
      }));
      return;
    }

    if (event.key === 'Escape') {
      setOpenDropdownRowId(null);
      return;
    }

    if (event.key !== 'Enter') return;
    event.preventDefault();

    const exactMatch = getExactSkuMatch((rows.find((row) => row.id === rowId)?.sku) ?? '');
    if (exactMatch) {
      selectSearchMatch(rowId, exactMatch, true);
      return;
    }

    if (matches.length > 0 && openDropdownRowId === rowId) {
      const selectedMatch = matches[Math.min(highlightedIndex, matches.length - 1)];
      if (selectedMatch) {
        selectSearchMatch(rowId, selectedMatch, true);
        return;
      }
    }

    handleRowAdvance(rowId);
  };

  const activeRows = rows.filter((row) => hasBulkRowContent(row));

  const handleConfirm = async () => {
    setPanelError('');
    const nextRows = rows.map((row) => {
      if (!hasBulkRowContent(row)) return row;
      const quantity = parseInt(row.quantity, 10);
      const printQuantity = parseInt(row.printQuantity, 10);
      if (!row.productId) {
        return { ...row, error: row.error || 'Producto no encontrado', status: 'error' as const };
      }
      if (Number.isNaN(quantity) || quantity <= 0) {
        return { ...row, error: 'Cantidad inválida', status: 'error' as const };
      }
      if (row.printLabels && (Number.isNaN(printQuantity) || printQuantity <= 0)) {
        return { ...row, error: 'Cantidad de etiquetas inválida', status: 'error' as const };
      }
      return { ...row, error: '', status: 'matched' as const };
    });
    setRows(nextRows);

    const validRows = nextRows.filter((row) => hasBulkRowContent(row) && !row.error && row.productId !== null);
    const invalidRows = nextRows.filter((row) => hasBulkRowContent(row) && (row.error || row.productId === null));
    if (validRows.length === 0) {
      setPanelError('Agregá al menos una fila válida para confirmar el ingreso.');
      return;
    }
    if (invalidRows.length > 0) {
      setPanelError('Corregí las filas marcadas antes de confirmar el ingreso.');
      return;
    }

    setSubmitting(true);
    const failedRowIds = new Set<number>();
    const failureDetails = new Map<number, string>();
    const printableRows: Array<{ name: string; sku: string; quantity: number }> = [];
    let successCount = 0;

    for (const row of validRows) {
      try {
        await createStockInbound({
          product_id: row.productId!,
          quantity: parseInt(row.quantity, 10),
          reason: 'Ingreso masivo',
        });
        successCount += 1;
        if (row.printLabels) {
          printableRows.push({
            name: row.productName,
            sku: row.sku,
            quantity: parseInt(row.printQuantity, 10),
          });
        }
      } catch (error) {
        failedRowIds.add(row.id);
        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        failureDetails.set(row.id, detail ?? 'No se pudo procesar esta fila');
      }
    }

    setSubmitting(false);

    const totalLabels = printableRows.reduce((sum, row) => sum + row.quantity, 0);
    let printSummary = '';
    if (printableRows.length > 0) {
      try {
        await generateLabelsPDFByItems(printableRows);
        printSummary = ` Se generaron ${totalLabels} etiqueta${totalLabels !== 1 ? 's' : ''}.`;
      } catch {
        printSummary = ' El ingreso se procesó, pero no se pudieron generar las etiquetas.';
      }
    }

    if (failedRowIds.size === 0) {
      setRows([createEmptyBulkRow()]);
      await onCompleted(
        `${successCount} ingreso${successCount !== 1 ? 's' : ''} masivo${successCount !== 1 ? 's' : ''} procesado${successCount !== 1 ? 's' : ''} correctamente.${printSummary}`,
      );
      return;
    }

    const remainingRows = nextRows
      .filter((row) => failedRowIds.has(row.id))
      .map((row) => ({
        ...row,
        error: failureDetails.get(row.id) ?? row.error,
        status: 'error' as const,
      }));
    const nextBlankRow = createEmptyBulkRow();
    setRows([...remainingRows, nextBlankRow]);
    await onCompleted(
      `${successCount} fila${successCount !== 1 ? 's' : ''} procesada${successCount !== 1 ? 's' : ''}. Revisá las filas con error para reintentar.${printSummary}`,
    );
  };

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl border border-green-200 shadow-xl w-full max-w-6xl max-h-[86vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-green-200 bg-green-50 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-green-700">Ingreso masivo</h2>
            <p className="text-sm text-green-700 mt-1">
              Cargá varios SKU seguidos
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm font-medium text-green-700 hover:text-green-700 transition"
          >
            Cerrar
          </button>
        </div>

        <div className="p-6 space-y-4 flex-1 min-h-0 overflow-auto">
          {panelError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {panelError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200">
                  <th className="pb-3 pr-3 font-medium text-gray-500">SKU</th>
                  <th className="pb-3 px-3 font-medium text-gray-500">Cliente</th>
                  <th className="pb-3 px-3 font-medium text-gray-500">Producto</th>
                  <th className="pb-3 px-3 font-medium text-gray-500">Cantidad</th>
                  <th className="pb-3 px-3 font-medium text-gray-500">Imprimir etiquetas</th>
                  <th className="pb-3 pl-3 font-medium text-gray-500">Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const quantityInvalid = row.quantity.trim() !== '' && (Number.isNaN(parseInt(row.quantity, 10)) || parseInt(row.quantity, 10) <= 0);
                  const rowHasError = row.status === 'error';
                  const debouncedQuery = normalizeSku(debouncedQueries[row.id] ?? '');
                  const rowMatches = searchMatchesByRow.get(row.id) ?? [];
                  const shouldShowDropdown = openDropdownRowId === row.id && debouncedQuery.length > 0 && rowMatches.length > 0 && row.productId === null;
                  const showNoResults = openDropdownRowId === row.id && debouncedQuery.length > 0 && rowMatches.length === 0 && row.productId === null;
                  const displayError = row.error || (showNoResults ? 'Producto no encontrado' : '');
                  return (
                    <tr key={row.id} className="border-b border-gray-200 last:border-b-0 align-top">
                      <td className="py-2.5 pr-3 w-[220px] relative">
                        <input
                          ref={(element) => {
                            searchInputRefs.current[row.id] = element;
                          }}
                          type="text"
                          value={row.sku}
                          onChange={(event) => handleSkuChange(row.id, event.target.value)}
                          onFocus={() => {
                            if (normalizeSku(row.sku).length > 0) {
                              setOpenDropdownRowId(row.id);
                            }
                          }}
                          onBlur={() => {
                            window.setTimeout(() => {
                              setOpenDropdownRowId((current) => (current === row.id ? null : current));
                            }, 120);
                          }}
                          onKeyDown={(event) => handleSkuKeyDown(row.id, event)}
                          className={`w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            row.status === 'matched'
                              ? 'border-green-200 bg-green-50'
                              : rowHasError
                                ? 'border-red-200 bg-red-50'
                                : 'border-gray-200 bg-white'
                          }`}
                          placeholder="Escaneá o buscá por SKU o nombre"
                          autoComplete="off"
                        />
                        {shouldShowDropdown && (
                          <div className="absolute left-0 right-3 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                            {rowMatches.map((product, index) => (
                              <button
                                key={`${row.id}-${product.id}`}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  selectSearchMatch(row.id, product);
                                }}
                                className={`w-full px-3 py-2.5 text-left text-sm transition ${
                                  index === (highlightedIndexByRow[row.id] ?? 0)
                                    ? 'bg-green-50 text-green-700'
                                    : 'bg-white text-gray-900 hover:bg-gray-50'
                                }`}
                              >
                                <div className="font-medium text-gray-900">{product.name} (SKU: {product.sku}){!product.is_active ? ' · Inactivo' : ''}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{clientNameById.get(product.client_id) ?? '—'}</div>
                              </button>
                            ))}
                          </div>
                        )}
                        {displayError && <p className="text-xs text-red-700 mt-1">{displayError}</p>}
                      </td>
                      <td className="py-2.5 px-3 w-[180px]">
                        <div className={`min-h-[38px] px-3 py-2 rounded-lg border ${row.clientId ? 'border-gray-200 bg-gray-50 text-gray-900' : 'border-dashed border-gray-200 text-gray-500 bg-gray-50/60'}`}>
                          {row.clientName || 'Autocompletado'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 min-w-[240px]">
                        <div className={`min-h-[38px] px-3 py-2 rounded-lg border ${row.productId ? 'border-gray-200 bg-gray-50 text-gray-900' : 'border-dashed border-gray-200 text-gray-500 bg-gray-50/60'}`}>
                          {row.productName || 'Autocompletado'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 w-[120px]">
                        <input
                          type="number"
                          min={1}
                          value={row.quantity}
                          onChange={(event) => handleQuantityChange(row.id, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            handleRowAdvance(row.id);
                          }}
                          className={`w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${quantityInvalid ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}
                        />
                      </td>
                      <td className="py-2.5 px-3 w-[210px]">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap cursor-pointer">
                            <input
                              type="checkbox"
                              checked={row.printLabels}
                              onChange={(event) => handlePrintToggle(row.id, event.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-green-700 focus:ring-blue-500"
                            />
                            Imprimir
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={row.printQuantity}
                            onChange={(event) => handlePrintQuantityChange(row.id, event.target.value)}
                            disabled={!row.printLabels}
                            className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                            placeholder="#"
                          />
                        </div>
                      </td>
                      <td className="py-2.5 pl-3 w-[90px]">
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg transition"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="text-sm text-gray-500">
              {activeRows.length} fila{activeRows.length !== 1 ? 's' : ''} lista{activeRows.length !== 1 ? 's' : ''} para procesar
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => appendRow()}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Agregar fila
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
              >
                {submitting ? 'Procesando...' : 'Confirmar ingreso'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Stock Move Modal (Ingresar / Retirar) ─── */
function StockMoveModal({
  type,
  products,
  clients,
  stockMap,
  clientMap,
  preselectedProductId,
  onClose,
  onSubmit,
}: {
  type: 'in' | 'out';
  products: Product[];
  clients: Client[];
  stockMap: Map<number, StockItem>;
  clientMap: Map<number, string>;
  preselectedProductId: number | null;
  onClose: () => void;
  onSubmit: (
    productId: number,
    quantity: number,
    reason: string,
    notes: string,
    labelOptions?: { enabled: boolean; quantity: number },
  ) => Promise<void>;
}) {
  const preselectedProduct = preselectedProductId
    ? products.find((product) => product.id === preselectedProductId) ?? null
    : null;
  const [selectedClientId, setSelectedClientId] = useState(preselectedProduct?.client_id.toString() ?? '');
  const [productId, setProductId] = useState(preselectedProductId?.toString() ?? '');
  const [skuQuery, setSkuQuery] = useState(preselectedProduct?.sku ?? '');
  const [quantity, setQuantity] = useState('');
  const [printLabels, setPrintLabels] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const isIn = type === 'in';
  const title = isIn ? 'Ingresar stock' : 'Retirar stock';
  const buttonColor = isIn
    ? 'bg-green-600 hover:opacity-90'
    : 'bg-red-600 hover:opacity-90';
  const reasonOptions = isIn ? REASON_OPTIONS_IN : REASON_OPTIONS_OUT;

  const selectableProducts = useMemo(
    () => [...products].sort((left, right) => {
      if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
      return left.name.localeCompare(right.name, 'es');
    }),
    [products],
  );
  const filteredProducts = useMemo(() => {
    const filtered = selectedClientId
      ? selectableProducts.filter((product) => product.client_id === parseInt(selectedClientId))
      : selectableProducts;
    return [...filtered].sort((left, right) => left.name.localeCompare(right.name, 'es'));
  }, [selectableProducts, selectedClientId]);
  const selectedProduct = productId ? selectableProducts.find((product) => product.id === parseInt(productId)) ?? null : null;
  const stockEntry = selectedProduct ? stockMap.get(selectedProduct.id) : null;
  const availableStock = stockEntry?.quantity_available ?? 0;
  const selectedClientName = selectedProduct ? (clientMap.get(selectedProduct.client_id) ?? '—') : null;
  const exactSkuMatches = useMemo(() => {
    const normalized = normalizeSku(skuQuery);
    if (!normalized) return [] as Product[];
    return selectableProducts.filter((product) => normalizeSku(product.sku) === normalized);
  }, [selectableProducts, skuQuery]);
  const autoMatchedBySku = exactSkuMatches.length === 1;
  const duplicatedSku = exactSkuMatches.length > 1;
  const skuNotFound = normalizeSku(skuQuery).length > 0 && exactSkuMatches.length === 0;

  const qty = parseInt(quantity);
  const exceedsStock = !isIn && !isNaN(qty) && selectedProduct !== null && qty > availableStock;

  useEffect(() => {
    if (!selectedProduct) return;
    setSelectedClientId(selectedProduct.client_id.toString());
  }, [selectedProduct]);

  useEffect(() => {
    if (!selectedClientId || !selectedProduct) return;
    if (selectedProduct.client_id !== parseInt(selectedClientId)) {
      setProductId('');
    }
  }, [selectedClientId, selectedProduct]);

  useEffect(() => {
    if (duplicatedSku) {
      setProductId('');
      return;
    }
    if (!autoMatchedBySku) return;
    const matchedProduct = exactSkuMatches[0];
    setSelectedClientId(matchedProduct.client_id.toString());
    setProductId(matchedProduct.id.toString());
    setFormError('');
  }, [autoMatchedBySku, duplicatedSku, exactSkuMatches]);

  const handleClientChange = (value: string) => {
    setSelectedClientId(value);
    setFormError('');
    if (!value) return;
    if (!selectedProduct || selectedProduct.client_id !== parseInt(value)) {
      setProductId('');
    }
  };

  const handleProductChange = (value: string) => {
    setProductId(value);
    setFormError('');
    const nextProduct = value
      ? selectableProducts.find((product) => product.id === parseInt(value)) ?? null
      : null;
    if (nextProduct) {
      setSelectedClientId(nextProduct.client_id.toString());
      if (!autoMatchedBySku) {
        setSkuQuery(nextProduct.sku);
      }
    }
  };

  const handleSkuChange = (value: string) => {
    setSkuQuery(value);
    setFormError('');
    if (!value.trim()) {
      return;
    }
    const normalized = normalizeSku(value);
    const matches = selectableProducts.filter((product) => normalizeSku(product.sku) === normalized);
    if (matches.length !== 1) {
      setProductId('');
    }
  };

  const skuInputStateClass = duplicatedSku
    ? 'border-red-200 bg-red-50'
    : autoMatchedBySku
      ? 'border-green-200 bg-green-50'
      : skuNotFound
        ? 'border-yellow-200 bg-yellow-50'
        : 'border-gray-200';
  const selectorDisabled = autoMatchedBySku;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!productId || isNaN(qty) || qty <= 0) {
      setFormError('Seleccioná un producto y una cantidad válida');
      return;
    }
    if (!reason) {
      setFormError('Seleccioná un motivo');
      return;
    }
    if (exceedsStock) {
      setFormError('No hay suficiente stock disponible');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await onSubmit(
        parseInt(productId),
        qty,
        reason,
        notes,
        isIn && printLabels
          ? { enabled: true, quantity: qty }
          : { enabled: false, quantity: 0 },
      );
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        (isIn ? 'Error al ingresar stock' : 'Error al retirar stock');
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[640px] p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span
              className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                isIn ? 'bg-green-600' : 'bg-red-600'
              }`}
            >
              {isIn ? '+' : '−'}
            </span>
            {title}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">
            &times;
          </button>
        </div>

        {formError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Cliente</label>
              <select
                value={selectedClientId}
                disabled={selectorDisabled}
                onChange={(e) => handleClientChange(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500 ${autoMatchedBySku ? 'border-green-200' : 'border-gray-200'}`}
              >
                <option value="">Todos los clientes</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              {autoMatchedBySku && (
                <p className="text-xs text-green-700 mt-1">Cliente autocompletado por SKU. Limpiá el SKU para editar manualmente.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Buscar por SKU</label>
              <div className="relative">
                <input
                  type="text"
                  value={skuQuery}
                  onChange={(e) => handleSkuChange(e.target.value)}
                  className={`w-full px-4 py-2.5 pr-10 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${skuInputStateClass}`}
                  placeholder="Ej: 222"
                  autoComplete="off"
                />
                {autoMatchedBySku && (
                  <span className="absolute inset-y-0 right-3 flex items-center text-green-700 text-sm">✓</span>
                )}
              </div>
              {autoMatchedBySku && selectedProduct && (
                <p className="text-xs text-green-700 mt-1">
                  SKU encontrado. Se seleccionó {selectedProduct.name} de {clientMap.get(selectedProduct.client_id) ?? '—'}.
                </p>
              )}
              {skuNotFound && (
                <p className="text-xs text-yellow-800 mt-1">No se encontró un producto con ese SKU.</p>
              )}
              {duplicatedSku && (
                <p className="text-xs text-red-700 mt-1">Ese SKU no es único. Revisá los productos antes de operar.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-start">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Producto</label>
              <select
                required
                value={productId}
                disabled={selectorDisabled}
                onChange={(e) => handleProductChange(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500 ${autoMatchedBySku ? 'border-green-200' : 'border-gray-200'}`}
              >
                <option value="">Seleccionar producto...</option>
                {filteredProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (SKU: {p.sku}){!p.is_active ? ' · Inactivo' : ''}
                  </option>
                ))}
              </select>
              {selectedClientId && filteredProducts.length === 0 && (
                <p className="text-xs text-yellow-800 mt-1">No hay productos cargados para el cliente seleccionado.</p>
              )}
              {autoMatchedBySku && (
                <p className="text-xs text-green-700 mt-1">Producto autoseleccionado por SKU.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Cantidad</label>
              <input
                type="number"
                required
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${
                  exceedsStock ? 'border-red-200 bg-red-50' : 'border-gray-200'
                }`}
                placeholder="Ej: 100"
              />
              {exceedsStock && (
                <p className="text-red-700 text-xs mt-1">No hay suficiente stock disponible (disponible: {availableStock})</p>
              )}
            </div>
          </div>

          {/* Contexto del producto seleccionado */}
          {selectedProduct && stockEntry && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              {!selectedProduct.is_active && (
                <p className="text-xs text-yellow-800">Este producto está inactivo, pero igual podés moverle stock.</p>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <div>
                  <span className="text-gray-500">Total:</span>{' '}
                  <span className="font-bold text-gray-900">{stockEntry.quantity_total}</span>
                </div>
                <div>
                  <span className="text-gray-500">Reservado:</span>{' '}
                  <span className={`font-bold ${stockEntry.quantity_reserved > 0 ? 'text-blue-700' : 'text-gray-500'}`}>
                    {stockEntry.quantity_reserved}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Disponible:</span>{' '}
                  <span className={`font-bold ${
                    availableStock === 0 ? 'text-red-700' : isLowStock(stockEntry) ? 'text-yellow-800' : 'text-green-700'
                  }`}>
                    {availableStock}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-gray-500">Cliente:</span>{' '}
                <span className="font-medium text-gray-900">{selectedClientName}</span>
              </div>
            </div>
          )}

          {isIn && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-3">
              <label className="flex items-center gap-3 text-sm font-medium text-gray-900">
                <input
                  type="checkbox"
                  checked={printLabels}
                  onChange={(e) => setPrintLabels(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-200 text-green-700 focus:ring-blue-500"
                />
                Imprimir etiquetas
              </label>

              <p className="text-xs text-gray-500">
                Se imprimirán automáticamente etiquetas según la cantidad ingresada.
              </p>

              {printLabels && quantity.trim() && !Number.isNaN(qty) && qty > 0 && (
                <p className="text-xs font-medium text-gray-900">
                  Se imprimirán {qty} etiqueta{qty !== 1 ? 's' : ''}.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Motivo</label>
            <select
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">Seleccionar motivo...</option>
              {reasonOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Notas <span className="text-gray-500 font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Detalle adicional..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || exceedsStock}
              className={`flex-1 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ${buttonColor}`}
            >
              {saving ? 'Procesando...' : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Movement History Modal ─── */

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  inbound: 'Ingreso',
  outbound: 'Egreso',
  reservation: 'Reserva',
  reservation_release: 'Liberación',
  adjustment: 'Ajuste',
};

const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  inbound: 'bg-green-50 text-green-700',
  outbound: 'bg-red-50 text-red-700',
  reservation: 'bg-blue-50 text-blue-700',
  reservation_release: 'bg-blue-50 text-blue-700',
  adjustment: 'bg-gray-50 text-gray-900',
};

type MovementFilter = 'all' | 'inbound' | 'outbound' | 'reservation';

const FILTER_OPTIONS: { value: MovementFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'inbound', label: 'Ingresos' },
  { value: 'outbound', label: 'Egresos' },
  { value: 'reservation', label: 'Reservas' },
];

function MovementHistoryModal({
  product,
  clientName,
  stockEntry,
  onClose,
}: {
  product: Product;
  clientName: string;
  stockEntry: StockItem | null;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MovementFilter>('all');

  useEffect(() => {
    fetchMovementsByProduct(product.id, 100)
      .then(setMovements)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [product.id]);

  const avail = stockEntry?.quantity_available ?? 0;

  const filtered = useMemo(() => {
    if (filter === 'all') return movements;
    if (filter === 'reservation') return movements.filter((m) => m.movement_type === 'reservation' || m.movement_type === 'reservation_release');
    return movements.filter((m) => m.movement_type === filter);
  }, [movements, filter]);

  const buildDescription = (m: StockMovement): string => {
    const typeLabel = MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type;
    const parts: string[] = [typeLabel];
    if (m.notes) parts.push(`(${m.notes})`);
    else if (m.reference_type === 'order' && m.reference_id) parts.push(`(Pedido #${m.reference_id})`);
    return parts.join(' ');
  };

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-6 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Historial de movimientos</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {product.name}{' '}
              <span className="bg-gray-50 text-gray-900 px-1.5 py-0.5 rounded font-mono text-xs">
                {product.sku}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">
            &times;
          </button>
        </div>

        {/* Contexto */}
        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm mb-4">
          <div className="flex gap-6">
            <div>
              <span className="text-gray-500">Total:</span>{' '}
              <span className="font-bold text-gray-900">{stockEntry?.quantity_total ?? 0}</span>
            </div>
            <div>
              <span className="text-gray-500">Reservado:</span>{' '}
              <span className={`font-bold ${(stockEntry?.quantity_reserved ?? 0) > 0 ? 'text-blue-700' : 'text-gray-500'}`}>
                {stockEntry?.quantity_reserved ?? 0}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Disponible:</span>{' '}
              <span className={`font-bold ${
                avail === 0 ? 'text-red-700' : isLowStock(stockEntry) ? 'text-yellow-800' : 'text-green-700'
              }`}>
                {avail}
              </span>
            </div>
          </div>
          <div>
            <span className="text-gray-500">Cliente:</span>{' '}
            <span className="font-medium text-gray-900">{clientName}</span>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-4">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                filter === opt.value
                  ? 'bg-primary text-white'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Lista de movimientos */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-500">Sin movimientos registrados</div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((m) => {
                const isPositive = m.quantity > 0;
                return (
                  <div
                    key={m.id}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-gray-50 hover:bg-gray-50 transition"
                  >
                    <span
                      className={`w-14 text-right font-bold text-sm tabular-nums shrink-0 pt-0.5 ${
                        isPositive ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {isPositive ? '+' : ''}{m.quantity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${MOVEMENT_TYPE_COLORS[m.movement_type] ?? 'bg-gray-50 text-gray-500'}`}>
                          {MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}
                        </span>
                        <span className="text-sm text-gray-900 truncate">{buildDescription(m).replace(MOVEMENT_TYPE_LABELS[m.movement_type] ?? '', '').replace(/^\s*/, '')}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        {m.performed_by_name && (
                          <span>{m.performed_by_name}</span>
                        )}
                        {m.performed_by_name && <span>·</span>}
                        <span>{formatMovementDate(m.created_at)}</span>
                        {m.reference_type === 'order' && m.reference_id && (
                          <>
                            <span>·</span>
                            <span className="text-blue-700">Pedido #{m.reference_id}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-4 mt-auto">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
