import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { useProducts } from '../hooks/useProducts';
import { fetchClients, type Client } from '../services/clients';
import { fetchStock, fetchStockMovements, type StockItem, type StockMovement } from '../services/stock';
import { fetchLocations, type Location } from '../services/locations';
import { recordFirstProductLabelPrint, type Product, type ProductCreatePayload, type ProductPreparationType, type ProductUpdatePayload } from '../services/products';
import { generateLabelsPDF } from '../utils/labels';
import SuccessToast from '../components/SuccessToast';

function formatLastMovement(date: string | undefined): string {
  if (!date) return 'Sin movimiento';
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return `Hace ${diffDays} días`;
}

function parseMercadoLibreItemReference(rawValue: string): { normalized: string[]; error: string | null } {
  const trimmedValue = rawValue.trim();
  if (!trimmedValue) {
    return { normalized: [], error: null };
  }

  if (/\/P\/ML[A-Z]{2}\d+/i.test(trimmedValue) || /\bML[A-Z]{2}\d+\b/i.test(trimmedValue)) {
    return {
      normalized: [],
      error: 'Ese codigo parece ser de la pagina de producto (por ejemplo /p/MLAU...). Para mapear, usá el ID de la publicacion: MLA123..., el link de la publicacion o el item_id real del pedido.',
    };
  }

  const parts = trimmedValue
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const match = part.toUpperCase().match(/(ML[A-Z])[-_\s]?(\d+)/);
    if (!match) {
      return {
        normalized: [],
        error: 'Ingresá links o IDs válidos de publicaciones de MercadoLibre, uno por línea. No uses códigos /p/MLAU... de páginas de producto.',
      };
    }

    const itemId = `${match[1]}${match[2]}`;
    if (!seen.has(itemId)) {
      seen.add(itemId);
      normalized.push(itemId);
    }
  }

  return { normalized, error: null };
}

function calculateVolumePreview(widthCm: string, heightCm: string, depthCm: string): string {
  const values = [widthCm, heightCm, depthCm].map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return '—';
  }
  return `${((values[0] * values[1] * values[2]) / 1000000).toFixed(4)} m3`;
}

const LOW_STOCK_THRESHOLD = 5;
const PREPARATION_TYPE_OPTIONS: Array<{ value: ProductPreparationType; label: string }> = [
  { value: 'simple', label: 'Preparación simple' },
  { value: 'intermedio', label: 'Preparación intermedia' },
  { value: 'premium', label: 'Preparación premium' },
];

export default function Products() {
  const navigate = useNavigate();
  const { products, loading, error, add, update, toggleActive, remove } = useProducts();
  const [clients, setClients] = useState<Client[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [activeCreateClientId, setActiveCreateClientId] = useState('');
  const [createFormVersion, setCreateFormVersion] = useState(0);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [printingProduct, setPrintingProduct] = useState<Product | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<Product | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterClientId, setFilterClientId] = useState('');

  useEffect(() => {
    fetchClients().then(setClients).catch(() => {});
    fetchStock().then(setStockItems).catch(() => {});
    fetchStockMovements().then(setMovements).catch(() => {});
    fetchLocations().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    const handleOutsideClick = () => setOpenActionMenuId(null);
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  const clientMap = new Map(clients.map((c) => [c.id, c.name]));

  const stockByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of stockItems) {
      map.set(s.product_id, (map.get(s.product_id) ?? 0) + s.quantity);
    }
    return map;
  }, [stockItems]);

  const lastMovementByProduct = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of movements) {
      if (!map.has(m.product_id)) {
        map.set(m.product_id, m.created_at);
      }
    }
    return map;
  }, [movements]);

  const filtered = useMemo(() => {
    let list = [...products].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (filterClientId) {
      list = list.filter((p) => p.client_id === parseInt(filterClientId));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
      );
    }
    return list;
  }, [products, search, filterClientId]);

  const handleToggle = async (product: Product) => {
    setActionError('');
    setActionLoading(product.id);
    try {
      await toggleActive(product.id, product.is_active);
      setConfirmToggle(null);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al cambiar estado';
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenCreateForm = () => {
    setActiveCreateClientId('');
    setCreateFormVersion((current) => current + 1);
    setShowForm(true);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Productos</h1>
          <p className="text-gray-500 text-sm mt-1">Gestioná los productos y sus SKUs</p>
        </div>
        <button
          onClick={handleOpenCreateForm}
          className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Nuevo producto
        </button>
      </div>

      {showForm && (
        <CreateProductForm
          key={createFormVersion}
          clients={clients}
          locations={locations}
          activeClientId={activeCreateClientId}
          onActiveClientChange={setActiveCreateClientId}
          onCancel={() => setShowForm(false)}
          addProduct={add}
        />
      )}

      {(error || actionError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          {error || actionError}
        </div>
      )}

      {!showForm && (
        <>
          {/* Search & Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              placeholder="Buscar por nombre o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
            />
            <select
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-sm"
            >
              <option value="">Todos los clientes</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando productos...</div>
      ) : products.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No hay productos registrados</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No se encontraron productos con estos filtros</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0 table-scroll-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Nombre</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">SKU</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">MercadoLibre</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Ubicación</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Stock</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Último movimiento</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const qty = stockByProduct.get(p.id) ?? 0;
                const isZeroStock = qty === 0;
                const isLowStock = qty > 0 && qty <= LOW_STOCK_THRESHOLD;
                return (
                <tr
                  key={p.id}
                  onClick={() => setEditingProduct(p)}
                  className={`border-b border-gray-200 cursor-pointer ${!p.is_active ? 'opacity-60 bg-gray-50/70' : 'bg-white'} hover:bg-gray-50`}
                >
                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-900">{p.name}</div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {p.volume_m3 !== null ? `${p.volume_m3.toFixed(4)} m3 por unidad` : 'Sin medidas cargadas'}
                    </div>
                    {!p.is_active && (
                      <div className="mt-1 text-[11px] text-gray-500 uppercase tracking-wide">Inactivo</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs text-gray-500">
                      {p.sku}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {p.has_ml_mapping ? (
                      <div className="flex flex-col gap-1">
                        <span className="w-fit rounded-full bg-yellow-50 text-yellow-800 px-2 py-1 text-xs font-medium">
                          ML vinculado
                        </span>
                        {p.ml_item_ids.length > 0 && (
                          <span className="font-mono text-[11px] text-gray-500">
                            {p.ml_item_ids[0]}{p.ml_item_ids.length > 1 ? ` +${p.ml_item_ids.length - 1} más` : ''}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">Sin mapping</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {p.client_name ?? clientMap.get(p.client_id) ?? `Cliente ${p.client_id}`}
                  </td>
                  <td className="px-6 py-4">
                    {p.location_code ? (
                      <span className="font-mono text-xs text-gray-700">
                        {p.location_code}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">Sin ubicación</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-gray-900">
                    <span className="font-semibold">{qty}</span>
                    <span className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
                      isZeroStock
                        ? 'bg-red-50 text-red-700'
                        : isLowStock
                          ? 'bg-yellow-50 text-yellow-800'
                          : 'bg-green-50 text-green-700'
                    }`}>
                      {isZeroStock ? '●' : isLowStock ? '●' : '●'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-sm">
                    {formatLastMovement(lastMovementByProduct.get(p.id))}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setEditingProduct(p)}
                        className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-50 transition"
                      >
                        Editar
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setOpenActionMenuId((current) => current === p.id ? null : p.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition"
                          aria-label="Más acciones"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {openActionMenuId === p.id && (
                          <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                            <button
                              onClick={() => {
                                setPrintingProduct(p);
                                setOpenActionMenuId(null);
                              }}
                              className="block w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                            >
                              Imprimir etiqueta
                            </button>
                            {p.has_ml_mapping && (
                              <button
                                onClick={() => {
                                  navigate(`/integrations/ml/mappings?q=${encodeURIComponent(p.sku)}`);
                                  setOpenActionMenuId(null);
                                }}
                                className="block w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                              >
                                Ver mapping
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setConfirmToggle(p);
                                setOpenActionMenuId(null);
                              }}
                              disabled={actionLoading === p.id}
                              className="block w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {actionLoading === p.id
                                ? 'Procesando...'
                                : p.is_active
                                  ? 'Desactivar'
                                  : 'Activar'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm toggle modal */}
      {confirmToggle && (
        <ConfirmModal
          title={confirmToggle.is_active ? 'Desactivar producto' : 'Activar producto'}
          message={
            confirmToggle.is_active
              ? `¿Estás seguro de desactivar "${confirmToggle.name}" (${confirmToggle.sku})? El producto no se eliminará, solo quedará inactivo.`
              : `¿Querés reactivar "${confirmToggle.name}" (${confirmToggle.sku})?`
          }
          confirmLabel={confirmToggle.is_active ? 'Desactivar' : 'Activar'}
          confirmColor={confirmToggle.is_active ? 'red' : 'green'}
          loading={actionLoading === confirmToggle.id}
          onConfirm={() => handleToggle(confirmToggle)}
          onCancel={() => { setConfirmToggle(null); setActionError(''); }}
          error={actionError}
        />
      )}

      {/* Edit modal */}
      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          locations={locations}
          onClose={() => setEditingProduct(null)}
          onSaved={() => setEditingProduct(null)}
          onDeleted={() => setEditingProduct(null)}
          updateProduct={update}
          deleteProduct={remove}
        />
      )}

      {printingProduct && (
        <LabelPrintModal
          product={printingProduct}
          onClose={() => setPrintingProduct(null)}
          onPrinted={(quantity) => {
            setSuccessMessage(
              `${quantity} etiqueta${quantity !== 1 ? 's' : ''} generada${quantity !== 1 ? 's' : ''} para ${printingProduct.name}.`,
            );
            setPrintingProduct(null);
          }}
        />
      )}

      {successMessage && <SuccessToast message={successMessage} onClose={() => setSuccessMessage('')} />}
    </div>
  );
}

/* ─── Confirm Modal ─── */
function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmColor,
  loading,
  onConfirm,
  onCancel,
  error,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: 'red' | 'green';
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  error?: string;
}) {
  const colorClasses =
    confirmColor === 'red'
      ? 'bg-red-600 hover:opacity-90 text-white'
      : 'bg-green-600 hover:opacity-90 text-white';

  return (
    <div className="app-modal-overlay">
      <div className="app-modal-panel max-w-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-5">{message}</p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ${colorClasses}`}
          >
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Product Modal ─── */
function EditProductModal({
  product,
  locations,
  onClose,
  onSaved,
  onDeleted,
  updateProduct,
  deleteProduct,
}: {
  product: Product;
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  updateProduct: (id: number, payload: ProductUpdatePayload) => Promise<Product>;
  deleteProduct: (id: number) => Promise<void>;
}) {
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku);
  const [mlItemReference, setMlItemReference] = useState(product.ml_item_ids?.join('\n') ?? product.ml_item_id ?? '');
  const [preparationType, setPreparationType] = useState<ProductPreparationType>(product.preparation_type ?? 'simple');
  const [locationId, setLocationId] = useState<string>(product.location_id?.toString() ?? '');
  const [widthCm, setWidthCm] = useState(product.width_cm?.toString() ?? '');
  const [heightCm, setHeightCm] = useState(product.height_cm?.toString() ?? '');
  const [depthCm, setDepthCm] = useState(product.depth_cm?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const mlItemDetection = useMemo(
    () => parseMercadoLibreItemReference(mlItemReference),
    [mlItemReference],
  );
  const volumePreview = useMemo(
    () => calculateVolumePreview(widthCm, heightCm, depthCm),
    [widthCm, heightCm, depthCm],
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (mlItemDetection.error) {
      setFormError(mlItemDetection.error);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await updateProduct(product.id, {
        name,
        sku,
        ml_item_reference: mlItemReference.trim() || null,
        preparation_type: preparationType,
        width_cm: widthCm ? Number(widthCm) : null,
        height_cm: heightCm ? Number(heightCm) : null,
        depth_cm: depthCm ? Number(depthCm) : null,
        location_id: locationId ? parseInt(locationId) : null,
      });
      onSaved();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al actualizar producto';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteProduct(product.id);
      onDeleted();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al eliminar producto';
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="app-modal-overlay">
      <div className="app-modal-panel max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Editar producto</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        {formError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nombre</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">SKU</label>
            <input
              type="text"
              required
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Links o IDs de MercadoLibre</label>
            <textarea
              value={mlItemReference}
              onChange={(e) => setMlItemReference(e.target.value)}
              rows={4}
              className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:border-blue-500 outline-none resize-y ${
                mlItemDetection.error ? 'border-red-200 focus:ring-blue-500' : 'border-gray-200 focus:ring-blue-500'
              }`}
              placeholder="Pegá uno o varios links/IDs, uno por línea"
            />
            {mlItemDetection.normalized.length > 0 && (
              <p className="mt-1 text-xs text-green-700">
                Publicaciones detectadas: {mlItemDetection.normalized.join(', ')}
              </p>
            )}
            {mlItemDetection.error && (
              <p className="mt-1 text-xs text-red-700">{mlItemDetection.error}</p>
            )}
            {!mlItemDetection.error && (
              <p className="text-xs text-gray-500 mt-1">
                Podés cargar varias publicaciones del mismo producto, una por línea. Usá el ID de la publicación (por ejemplo MLA123...) o el link de la publicación, no el código /p/MLAU... de la página de producto. Si vaciás el campo, se eliminan los mappings simples.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Tipo de preparación</label>
            <select
              value={preparationType}
              onChange={(e) => setPreparationType(e.target.value as ProductPreparationType)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              {PREPARATION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Ubicación</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">Sin ubicación</option>
              {locations.filter(l => l.is_active).map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.code}{loc.description ? ` — ${loc.description}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Medidas de la caja</h3>
              <p className="text-xs text-gray-500 mt-1">Cargá ancho, alto y profundidad en centímetros para calcular los m3 automáticamente.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="number"
                min="0"
                step="0.01"
                value={widthCm}
                onChange={(e) => setWidthCm(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Ancho cm"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Alto cm"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={depthCm}
                onChange={(e) => setDepthCm(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Profundidad cm"
              />
            </div>
            <p className="text-xs font-medium text-blue-700">Volumen estimado: {volumePreview}</p>
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
              disabled={saving}
              className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>

        {/* Zona de peligro */}
        <div className="mt-6 pt-5 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="w-full px-4 py-2.5 text-sm font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition"
          >
            Eliminar producto
          </button>
        </div>
      </div>

      {/* Confirm delete sub-modal */}
      {confirmDelete && (
        <div className="app-modal-overlay z-[10030]">
          <div className="app-modal-panel max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Eliminar producto</h3>
            <p className="text-sm text-gray-500 mb-5">
              ¿Seguro que querés eliminar este producto? Esta acción no se puede deshacer.
            </p>
            {deleteError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{deleteError}</div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDelete(false); setDeleteError(''); }}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Create Product Form ─── */
function CreateProductForm({
  clients,
  locations,
  activeClientId,
  onActiveClientChange,
  onCancel,
  addProduct,
}: {
  clients: Client[];
  locations: Location[];
  activeClientId: string;
  onActiveClientChange: (clientId: string) => void;
  onCancel: () => void;
  addProduct: (p: ProductCreatePayload) => Promise<Product>;
}) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [preparationType, setPreparationType] = useState<ProductPreparationType>('simple');
  const [locationId, setLocationId] = useState('');
  const [widthCm, setWidthCm] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [depthCm, setDepthCm] = useState('');
  const [mlItemReference, setMlItemReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [printOnCreate, setPrintOnCreate] = useState(false);
  const [printQuantity, setPrintQuantity] = useState('1');

  const activeClient = clients.find((client) => client.id === parseInt(activeClientId, 10)) ?? null;
  const mlItemDetection = useMemo(
    () => parseMercadoLibreItemReference(mlItemReference),
    [mlItemReference],
  );
  const volumePreview = useMemo(
    () => calculateVolumePreview(widthCm, heightCm, depthCm),
    [widthCm, heightCm, depthCm],
  );

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeClientId) {
      setFormError('Seleccioná un cliente primero');
      return;
    }
    if (!name.trim()) {
      setFormError('El nombre es obligatorio.');
      return;
    }
    if (!sku.trim()) {
      setFormError('El SKU es obligatorio.');
      return;
    }
    if (mlItemDetection.error) {
      setFormError(mlItemDetection.error);
      return;
    }
    const createdMappingsCount = mlItemDetection.normalized.length;
    const createdWithMlMapping = createdMappingsCount > 0;
    const normalizedPrintQuantity = parseInt(printQuantity, 10);
    if (printOnCreate && (Number.isNaN(normalizedPrintQuantity) || normalizedPrintQuantity <= 0)) {
      setFormError('La cantidad de etiquetas debe ser mayor a 0.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const created = await addProduct({
        name: name.trim(),
        sku: sku.trim(),
        client_id: parseInt(activeClientId, 10),
        ml_item_reference: mlItemReference.trim() || null,
        preparation_type: preparationType,
        width_cm: widthCm ? Number(widthCm) : null,
        height_cm: heightCm ? Number(heightCm) : null,
        depth_cm: depthCm ? Number(depthCm) : null,
        location_id: locationId ? parseInt(locationId) : null,
      });
      setName('');
      setSku('');
      setPreparationType('simple');
      setLocationId('');
      setWidthCm('');
      setHeightCm('');
      setDepthCm('');
      setMlItemReference('');
      if (printOnCreate) {
        try {
          await generateLabelsPDF([{ name: created.name, sku: created.sku }], normalizedPrintQuantity);
          await recordFirstProductLabelPrint(created.id);
          const message = `Producto creado + ${normalizedPrintQuantity} etiqueta${normalizedPrintQuantity !== 1 ? 's' : ''} generada${normalizedPrintQuantity !== 1 ? 's' : ''}.${createdWithMlMapping ? ` ${createdMappingsCount} mapping${createdMappingsCount !== 1 ? 's' : ''} ML generado${createdMappingsCount !== 1 ? 's' : ''}.` : ''}`;
          setFeedback({ tone: 'success', text: message });
        } catch {
          setFeedback({
            tone: 'warning',
            text: 'Producto creado. No se pudieron generar o registrar las etiquetas automáticamente.',
          });
        }
      } else {
        setFeedback({
          tone: 'success',
          text: `Producto creado: ${created.name} (${created.sku})${createdWithMlMapping ? ` · ${createdMappingsCount} mapping${createdMappingsCount !== 1 ? 's' : ''} ML generado${createdMappingsCount !== 1 ? 's' : ''}` : ''}`,
        });
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al crear producto';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetClientSelection = () => {
    onActiveClientChange('');
    setName('');
    setSku('');
    setPreparationType('simple');
    setLocationId('');
    setWidthCm('');
    setHeightCm('');
    setDepthCm('');
    setMlItemReference('');
    setFormError('');
    setFeedback(null);
    setShowClientSelector(true);
  };

  const selectorVisible = !activeClient || showClientSelector;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      {feedback && (
        <div className={`text-sm rounded-lg p-3 mb-4 border ${
          feedback.tone === 'success'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-yellow-50 border-yellow-200 text-yellow-800'
        }`}>
          {feedback.text}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Nuevo producto</h2>
          <p className="text-sm text-gray-500 mt-1">
            Alta continua para el cliente activo. El formulario se limpia después de cada creación.
          </p>
        </div>
        {activeClient && (
          <div className="flex items-center gap-3 sm:justify-end">
            <div className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium whitespace-nowrap">
              Cliente activo: {activeClient.name}
            </div>
            <button
              type="button"
              onClick={handleResetClientSelection}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cambiar cliente
            </button>
          </div>
        )}
      </div>

      {selectorVisible && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-900 mb-1">Cliente activo</label>
          <select
            value={activeClientId}
            onChange={(e) => {
              onActiveClientChange(e.target.value);
              setFormError('');
              setFeedback(null);
              setShowClientSelector(false);
            }}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="">Seleccionar cliente...</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </div>
      )}

      {formError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">Nombre</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            placeholder="Remera XL Azul"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">SKU</label>
          <input
            type="text"
            required
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
            placeholder="REM-XL-AZU-001"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">Tipo de preparación</label>
          <select
            value={preparationType}
            onChange={(e) => setPreparationType(e.target.value as ProductPreparationType)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            {PREPARATION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">Ubicación</label>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="">Sin ubicación</option>
            {locations.filter(l => l.is_active).map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.code}{loc.description ? ` — ${loc.description}` : ''}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Medidas de la caja</h3>
            <p className="text-xs text-gray-500 mt-1">Estas medidas permiten calcular el almacenamiento variable automáticamente.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="number"
              min="0"
              step="0.01"
              value={widthCm}
              onChange={(e) => setWidthCm(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Ancho cm"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Alto cm"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={depthCm}
              onChange={(e) => setDepthCm(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Profundidad cm"
            />
          </div>
          <p className="text-xs font-medium text-blue-700">Volumen estimado: {volumePreview}</p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-900 mb-1">Links o IDs de MercadoLibre</label>
          <textarea
            value={mlItemReference}
            onChange={(e) => setMlItemReference(e.target.value)}
            rows={4}
            className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:border-blue-500 outline-none resize-y ${
              mlItemDetection.error ? 'border-red-200 focus:ring-blue-500' : 'border-gray-200 focus:ring-blue-500'
            }`}
            placeholder="Pegá uno o varios links/IDs, uno por línea"
          />
          {mlItemDetection.normalized.length > 0 && (
            <p className="mt-1 text-xs text-green-700">
              Publicaciones detectadas: {mlItemDetection.normalized.join(', ')}
            </p>
          )}
          {mlItemDetection.error && (
            <p className="mt-1 text-xs text-red-700">{mlItemDetection.error}</p>
          )}
          {!mlItemDetection.error && (
            <p className="mt-1 text-xs text-gray-500">Campo opcional. Podés cargar varias publicaciones del mismo producto, una por línea.</p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 sm:col-span-2">
          <label className="flex items-center gap-3 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={printOnCreate}
              onChange={(e) => setPrintOnCreate(e.target.checked)}
              className="h-4 w-4 rounded border-gray-200 text-blue-700 focus:ring-blue-500"
            />
            Imprimir etiqueta al crear
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Cantidad de etiquetas
            </label>
            <input
              type="number"
              min={1}
              value={printQuantity}
              onChange={(e) => setPrintQuantity(e.target.value)}
              disabled={!printOnCreate}
              className="w-full sm:w-28 px-3 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
            />
            <p className="text-xs text-gray-500">
              Si está activo, se abre la impresión HTML de etiquetas al finalizar el alta.
            </p>
          </div>
        </div>

        <div className="sm:col-span-2 flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !activeClientId}
            className="ui-btn-primary px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear producto'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LabelPrintModal({
  product,
  onClose,
  onPrinted,
}: {
  product: Product;
  onClose: () => void;
  onPrinted: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState('1');
  const [printing, setPrinting] = useState(false);
  const [formError, setFormError] = useState('');

  const handlePrint = async () => {
    const normalizedQuantity = parseInt(quantity, 10);
    if (Number.isNaN(normalizedQuantity) || normalizedQuantity <= 0) {
      setFormError('Ingresá una cantidad válida de etiquetas.');
      return;
    }

    setPrinting(true);
    setFormError('');

    try {
      await generateLabelsPDF([{ name: product.name, sku: product.sku }], normalizedQuantity);
      await recordFirstProductLabelPrint(product.id);
      onPrinted(normalizedQuantity);
    } catch {
      setFormError('No se pudieron generar o registrar las etiquetas con código de barras.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="app-modal-overlay">
      <div className="app-modal-panel max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Imprimir etiqueta</h2>
            <p className="text-sm text-gray-500 mt-1">{product.name} · {product.sku}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        {formError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            {formError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Cantidad</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
            Se abrirá una etiqueta HTML de 50 mm x 30 mm con código de barras Code128 real, lista para imprimir desde el navegador.
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
              type="button"
              onClick={handlePrint}
              disabled={printing}
              className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {printing ? 'Generando...' : 'Imprimir'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
