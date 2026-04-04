import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchClients, type Client } from '../services/clients';
import {
  createMLMapping,
  deleteMLMapping,
  fetchMLMappings,
  type MLMapping,
  type MLMappingCreateResult,
} from '../services/mercadolibre';
import { fetchOrders, resolveMarketplaceOrderMapping, type Order } from '../services/orders';
import { fetchProducts, type Product } from '../services/products';
import SuccessToast from '../components/SuccessToast';

export default function MercadoLibreMappings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [mappings, setMappings] = useState<MLMapping[]>([]);
  const [unmappedOrders, setUnmappedOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [resolvingOrder, setResolvingOrder] = useState<Order | null>(null);

  const search = searchParams.get('q') ?? '';

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [clientsData, productsData, mappingsData, unmappedData] = await Promise.all([
        fetchClients(),
        fetchProducts(),
        fetchMLMappings(),
        fetchOrders(undefined, undefined, 'unmapped', 'mercadolibre'),
      ]);
      setClients(clientsData);
      setProducts(productsData);
      setMappings(mappingsData);
      setUnmappedOrders(unmappedData);
    } catch {
      setError('No se pudo cargar la configuración de MercadoLibre.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => {});
  }, []);

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const filteredMappings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter((mapping) => {
      const product = productMap.get(mapping.product_id);
      const client = clientMap.get(mapping.client_id);
      return [
        mapping.ml_item_id,
        mapping.ml_variation_id,
        product?.sku,
        product?.name,
        client?.name,
      ].some((value) => value?.toLowerCase().includes(q));
    });
  }, [mappings, search, productMap, clientMap]);

  const handleDeleteMapping = async (mapping: MLMapping) => {
    if (!window.confirm(`Eliminar el mapping ${mapping.ml_item_id}${mapping.ml_variation_id ? ` / ${mapping.ml_variation_id}` : ''}?`)) return;
    setError('');
    try {
      await deleteMLMapping(mapping.id);
      setMappings((current) => current.filter((item) => item.id !== mapping.id));
      setToastMessage('Mapping eliminado.');
    } catch {
      setError('No se pudo eliminar el mapping.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mappings de MercadoLibre</h1>
          <p className="text-sm text-gray-500 mt-1">
            Vinculá publicaciones externas con tus SKUs internos y resolvé pedidos simulados sin mapping.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium"
        >
          + Nuevo mapping
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Mappings activos" value={String(mappings.length)} tone="blue" />
        <SummaryCard label="Pedidos sin mapping" value={String(unmappedOrders.length)} tone="amber" />
        <SummaryCard label="Clientes con ML" value={String(new Set(mappings.map((item) => item.client_id)).size)} tone="emerald" />
      </div>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Pedidos pendientes de resolución</h2>
            <p className="text-sm text-gray-500 mt-1">Pedidos simulados de MercadoLibre creados sin SKU interno asignado.</p>
          </div>
          <Link to="/orders" className="text-sm text-blue-700 hover:text-blue-700 font-medium">Ver pedidos</Link>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500">Cargando pedidos...</div>
        ) : unmappedOrders.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No hay pedidos sin mapping.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Pedido</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Cliente</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">ML item</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Variación</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Cantidad</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">CP</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Acción</th>
                </tr>
              </thead>
              <tbody>
                {unmappedOrders.map((order) => (
                  <tr key={order.id} className="border-b border-gray-200 last:border-b-0">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{order.order_number}</div>
                      <div className="text-xs text-gray-500">{order.external_id || order.source_order_id || 'Sin external_id'}</div>
                    </td>
                    <td className="px-4 py-4 text-gray-500">{order.client_name ?? `#${order.client_id}`}</td>
                    <td className="px-4 py-4 font-mono text-xs text-gray-900">{order.ml_item_id ?? '—'}</td>
                    <td className="px-4 py-4 text-gray-500">{order.variation_id ?? '—'}</td>
                    <td className="px-4 py-4 text-gray-500">{order.requested_quantity ?? '—'}</td>
                    <td className="px-4 py-4 text-gray-500">{order.postal_code ?? '—'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setResolvingOrder(order)}
                        className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-50 transition"
                      >
                        Asignar SKU
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Mappings configurados</h2>
            <p className="text-sm text-gray-500 mt-1">Relación permanente entre item de MercadoLibre y producto interno.</p>
          </div>
          <input
            type="text"
            value={search}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                if (nextValue.trim()) {
                  next.set('q', nextValue);
                } else {
                  next.delete('q');
                }
                return next;
              }, { replace: true });
            }}
            placeholder="Buscar item, variación o SKU..."
            className="w-full sm:w-72 px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Cargando mappings...</div>
        ) : filteredMappings.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No hay mappings configurados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Producto interno</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">ML item</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Variación</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredMappings.map((mapping) => {
                  const product = productMap.get(mapping.product_id);
                  const client = clientMap.get(mapping.client_id);
                  return (
                    <tr key={mapping.id} className="border-b border-gray-200 last:border-b-0">
                      <td className="px-6 py-4 text-gray-900">{client?.name ?? `#${mapping.client_id}`}</td>
                      <td className="px-4 py-4 text-gray-900 font-medium">{product?.name ?? `Producto #${mapping.product_id}`}</td>
                      <td className="px-4 py-4"><span className="bg-gray-50 text-gray-900 px-2 py-0.5 rounded font-mono text-xs">{product?.sku ?? '—'}</span></td>
                      <td className="px-4 py-4 font-mono text-xs text-gray-900">{mapping.ml_item_id}</td>
                      <td className="px-4 py-4 text-gray-500">{mapping.ml_variation_id ?? '—'}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDeleteMapping(mapping).catch(() => {})}
                          className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-50 transition"
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
        )}
      </section>

      {showCreateModal && (
        <MLMappingModal
          clients={clients}
          products={products}
          onClose={() => setShowCreateModal(false)}
          onSaved={(result) => {
            setMappings((current) => [...current, result.mapping].sort((a, b) => a.ml_item_id.localeCompare(b.ml_item_id)));
            setToastMessage(
              result.reconciled_orders > 0
                ? `Mapping creado. Se resolvieron ${result.reconciled_orders} pedido${result.reconciled_orders !== 1 ? 's' : ''} automáticamente.`
                : 'Mapping creado correctamente.'
            );
            loadData().catch(() => {});
          }}
        />
      )}

      {resolvingOrder && (
        <ResolveUnmappedOrderModal
          order={resolvingOrder}
          products={products.filter((product) => product.client_id === resolvingOrder.client_id && product.is_active)}
          onClose={() => setResolvingOrder(null)}
          onResolved={(updatedOrder) => {
            setUnmappedOrders((current) => current.filter((item) => item.id !== updatedOrder.id));
            setResolvingOrder(null);
            setToastMessage(`Pedido ${updatedOrder.order_number} resuelto y listo para picking.`);
            loadData().catch(() => {});
          }}
        />
      )}

      {toastMessage && <SuccessToast message={toastMessage} onClose={() => setToastMessage('')} />}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'emerald' | 'amber' }) {
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    emerald: 'border-green-200 bg-green-50 text-green-700',
    amber: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  } as const;

  return (
    <div className={`rounded-xl border p-5 ${toneClasses[tone]}`}>
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}

function MLMappingModal({
  clients,
  products,
  onClose,
  onSaved,
}: {
  clients: Client[];
  products: Product[];
  onClose: () => void;
  onSaved: (result: MLMappingCreateResult) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [mlItemId, setMlItemId] = useState('');
  const [variationId, setVariationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const clientProducts = useMemo(() => {
    if (!clientId) return [];
    return products.filter((product) => product.client_id === Number(clientId) && product.is_active);
  }, [products, clientId]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!clientId || !productId || !mlItemId.trim()) {
      setError('Cliente, producto y ml_item_id son obligatorios.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      const result = await createMLMapping({
        client_id: Number(clientId),
        product_id: Number(productId),
        ml_item_id: mlItemId.trim(),
        ml_variation_id: variationId.trim() || null,
      });
      setProductId('');
      setMlItemId('');
      setVariationId('');
      setSuccessMessage(
        result.reconciled_orders > 0
          ? `✔ Se resolvieron ${result.reconciled_orders} pedido${result.reconciled_orders !== 1 ? 's' : ''} automáticamente`
          : '✔ Mapping creado correctamente. No había pedidos pendientes para reconciliar'
      );
      onSaved(result);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo guardar el mapping.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Nuevo mapping</h2>
            <p className="text-sm text-gray-500 mt-1">Relacioná un item de MercadoLibre con un SKU interno.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>
        <form onSubmit={(event) => { handleSubmit(event).catch(() => {}); }} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
          <Field label="Cliente">
            <select value={clientId} onChange={(event) => { setClientId(event.target.value); setProductId(''); }} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white">
              <option value="">Seleccionar cliente...</option>
              {clients.filter((client) => client.is_active).map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Producto interno">
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white" disabled={!clientId}>
              <option value="">Seleccionar producto...</option>
              {clientProducts.map((product) => (
                <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>
              ))}
            </select>
          </Field>
          <Field label="ML item ID">
            <input type="text" value={mlItemId} onChange={(event) => setMlItemId(event.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg" placeholder="MLA123456789" />
          </Field>
          <Field label="Variation ID">
            <input type="text" value={variationId} onChange={(event) => setVariationId(event.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg" placeholder="Opcional" />
          </Field>
          {successMessage && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              {successMessage}
            </div>
          )}
          <div className="pt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" disabled={saving} className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar mapping'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResolveUnmappedOrderModal({
  order,
  products,
  onClose,
  onResolved,
}: {
  order: Order;
  products: Product[];
  onClose: () => void;
  onResolved: (order: Order) => void;
}) {
  const [productId, setProductId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!productId) {
      setError('Seleccioná un producto interno.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await resolveMarketplaceOrderMapping(order.id, Number(productId));
      onResolved(updated);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo resolver el pedido.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Resolver pedido sin mapping</h2>
            <p className="text-sm text-gray-500 mt-1">Asigná un SKU interno y el sistema guardará el mapping automáticamente.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>
        <form onSubmit={(event) => { handleSubmit(event).catch(() => {}); }} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 space-y-1">
            <div><span className="text-gray-500">Pedido:</span> <span className="font-medium text-gray-900">{order.order_number}</span></div>
            <div><span className="text-gray-500">ML item:</span> <span className="font-mono text-gray-900">{order.ml_item_id ?? '—'}</span></div>
            <div><span className="text-gray-500">Variación:</span> <span className="text-gray-900">{order.variation_id ?? '—'}</span></div>
            <div><span className="text-gray-500">Cantidad:</span> <span className="text-gray-900">{order.requested_quantity ?? '—'}</span></div>
          </div>
          <Field label="Producto interno">
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white">
              <option value="">Seleccionar producto...</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>
              ))}
            </select>
          </Field>
          <div className="pt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" disabled={saving} className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Resolviendo...' : 'Guardar mapping y resolver'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      {children}
    </div>
  );
}