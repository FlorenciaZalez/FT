import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchClient, deleteClient, type Client } from '../services/clients';
import SuccessToast from '../components/SuccessToast';
import {
  createClientStorageRecord,
  deleteClientStorageRecord,
  fetchClientStorageRecords,
  updateClientStorageRecord,
  type ClientStorageRecord,
} from '../services/billing';
import { fetchProducts } from '../services/products';
import { fetchOrders, type Order } from '../services/orders';
import { fetchStockSummary, type StockSummaryItem } from '../services/stock';

const PLAN_LABELS: Record<string, string> = {
  basic: 'Básico',
  professional: 'Profesional',
  enterprise: 'Enterprise',
};

const PLAN_COLORS: Record<string, string> = {
  basic: 'bg-gray-50 text-gray-900',
  professional: 'bg-blue-50 text-blue-700',
  enterprise: 'bg-blue-50 text-blue-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  in_preparation: 'En preparación',
  prepared: 'Preparado',
  dispatched: 'Despachado',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-800',
  in_preparation: 'bg-blue-50 text-blue-700',
  prepared: 'bg-blue-50 text-blue-700',
  dispatched: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

const TABS = [
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'stock', label: 'Stock' },
  { key: 'ocupacion', label: 'Ocupación' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockItems, setStockItems] = useState<StockSummaryItem[]>([]);
  const [storageRecords, setStorageRecords] = useState<ClientStorageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('pedidos');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageEditing, setStorageEditing] = useState<ClientStorageRecord | null>(null);
  const [storageForm, setStorageForm] = useState({ period: '', storage_m3: '' });
  const [storageError, setStorageError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!id) return;
    const clientId = parseInt(id);
    let cancelled = false;

    setLoading(true);
    setError('');

    fetchClient(clientId)
      .then(async (clientData) => {
        if (cancelled) return;

        setClient(clientData);

        const [ordersResult, productsResult, stockResult, storageResult] = await Promise.allSettled([
          fetchOrders(),
          fetchProducts(),
          fetchStockSummary(),
          fetchClientStorageRecords({ client_id: clientId }),
        ]);

        if (cancelled) return;

        if (ordersResult.status === 'fulfilled') {
          setOrders(ordersResult.value.filter((o) => o.client_id === clientId));
        } else {
          setOrders([]);
        }

        if (productsResult.status === 'fulfilled' && stockResult.status === 'fulfilled') {
          const clientSkus = new Set(
            productsResult.value.filter((p) => p.client_id === clientId).map((p) => p.sku),
          );
          setStockItems(stockResult.value.filter((s) => clientSkus.has(s.sku)));
        } else {
          setStockItems([]);
        }

        if (storageResult.status === 'fulfilled') {
          setStorageRecords(storageResult.value);
          setStorageError('');
        } else {
          setStorageRecords([]);
          setStorageError('No se pudo cargar la ocupación mensual.');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Error al cargar el cliente');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Cargando...</div>;
  }

  if (error || !client) {
    return (
      <div className="text-center py-12">
        <p className="text-red-700 mb-4">{error || 'Cliente no encontrado'}</p>
        <button onClick={() => navigate('/clients')} className="text-blue-700 hover:underline text-sm">
          Volver a clientes
        </button>
      </div>
    );
  }

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ordersThisMonth = orders.filter((o) => {
    const d = new Date(o.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const lastOrder = orders.length > 0
    ? orders.reduce((latest, o) => (new Date(o.created_at) > new Date(latest.created_at) ? o : latest))
    : null;
  const currentStorageRecord = storageRecords.find((record) => record.period === currentPeriod);

  const reloadStorageRecords = async () => {
    if (!id) return;
    const data = await fetchClientStorageRecords({ client_id: Number(id) });
    setStorageRecords(data);
  };

  const openCreateStorageModal = () => {
    setStorageEditing(null);
    setStorageError('');
    setStorageForm({ period: currentPeriod, storage_m3: '' });
    setStorageModalOpen(true);
  };

  const openEditStorageModal = (record: ClientStorageRecord) => {
    setStorageEditing(record);
    setStorageError('');
    setStorageForm({ period: record.period, storage_m3: String(record.storage_m3) });
    setStorageModalOpen(true);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/clients')}
          className="text-gray-500 hover:text-gray-500 transition text-lg"
        >
          &larr;
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{client.name}</h1>
            <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${client.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {client.is_active ? 'Activo' : 'Inactivo'}
            </span>
            <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${PLAN_COLORS[client.plan] ?? 'bg-gray-50 text-gray-900'}`}>
              {PLAN_LABELS[client.plan] ?? client.plan}
            </span>
          </div>
          <a href={`mailto:${client.contact_email}`} className="text-gray-500 text-sm mt-0.5 hover:text-blue-700 hover:underline transition">{client.contact_email}</a>
        </div>
        <button
          onClick={() => navigate(`/clients/${id}/edit`)}
          className="ui-btn-primary shrink-0 px-4 py-2 text-sm font-medium rounded-lg"
        >
          Editar
        </button>
      </div>

      {/* Incomplete data banner */}
      {(!client.business_name || !client.tax_id || !client.contact_phone || !client.contact_name || !client.contact_phone_operational) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-yellow-800 text-lg">⚠</span>
            <div>
              <p className="text-sm font-medium text-yellow-800">Faltan datos del cliente</p>
              <p className="text-xs text-yellow-800 mt-0.5">
                {[
                  !client.business_name && 'razón social',
                  !client.tax_id && 'CUIT',
                  !client.contact_phone && 'teléfono principal',
                  !client.contact_name && 'nombre operativo',
                  !client.contact_phone_operational && 'teléfono operativo',
                ].filter(Boolean).join(', ')}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate(`/clients/${id}/edit`)}
            className="shrink-0 px-3 py-1.5 text-xs font-medium text-yellow-800 bg-yellow-50 rounded-lg hover:bg-yellow-50 transition"
          >
            Completar información
          </button>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
        <InfoCard label="Razón social" value={client.business_name || '—'} />
        <InfoCard label="CUIT" value={client.tax_id || '—'} />
        <InfoCard label="Teléfono principal" value={client.contact_phone || '—'} />
        <InfoCard label="Contacto operativo" value={client.contact_name || '—'} />
        <InfoCard label="Teléfono operativo" value={client.contact_phone_operational || '—'} />
        <InfoCard label="Día de cobro" value={client.billing_schedule?.active ? `Día ${client.billing_schedule.day_of_month}` : '—'} />
        <InfoCard label="Cliente desde" value={new Date(client.created_at).toLocaleDateString('es-AR')} />
      </div>

      {/* Métricas clickeables */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <button
          onClick={() => navigate(`/orders?client_id=${id}`)}
          className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4 text-left hover:border-blue-300 hover:shadow-sm transition group"
        >
          <div className="text-2xl">📦</div>
          <div className="flex-1">
            <p className="text-xs text-gray-500">Total de pedidos</p>
            <p className="text-xl font-bold text-gray-900">{orders.length}</p>
          </div>
          <span className="text-border group-hover:text-blue-700 transition text-lg">&rarr;</span>
        </button>
        <button
          onClick={() => {
            const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            navigate(`/orders?client_id=${id}&from=${start}`);
          }}
          className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4 text-left hover:border-blue-300 hover:shadow-sm transition group"
        >
          <div className="text-2xl">📅</div>
          <div className="flex-1">
            <p className="text-xs text-gray-500">Pedidos este mes</p>
            <p className="text-xl font-bold text-gray-900">{ordersThisMonth.length}</p>
          </div>
          <span className="text-border group-hover:text-blue-700 transition text-lg">&rarr;</span>
        </button>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="text-2xl">🕐</div>
          <div>
            <p className="text-xs text-gray-500">Último pedido</p>
            <p className="text-xl font-bold text-gray-900">
              {lastOrder ? new Date(lastOrder.created_at).toLocaleDateString('es-AR') : 'Sin pedidos'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-50 rounded-lg p-1 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {tab.label}
            {tab.key === 'pedidos' && orders.length > 0 && (
              <span className="ml-1.5 bg-gray-200 text-gray-500 text-xs px-1.5 py-0.5 rounded-full">{orders.length}</span>
            )}
            {tab.key === 'stock' && stockItems.length > 0 && (
              <span className="ml-1.5 bg-gray-200 text-gray-500 text-xs px-1.5 py-0.5 rounded-full">{stockItems.length}</span>
            )}
            {tab.key === 'ocupacion' && storageRecords.length > 0 && (
              <span className="ml-1.5 bg-gray-200 text-gray-500 text-xs px-1.5 py-0.5 rounded-full">{storageRecords.length}</span>
            )}
          </button>
        ))}
      </div>

      {successMessage && <SuccessToast message={successMessage} onClose={() => setSuccessMessage('')} />}

      {/* Tab content */}
      {activeTab === 'pedidos' && (
        <Section
          title="Pedidos"
          count={orders.length}
          action={
            <button
              onClick={() => navigate('/orders')}
              className="ui-btn-primary px-3 py-1.5 text-xs font-medium rounded-lg"
            >
              + Crear pedido
            </button>
          }
        >
          {orders.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">Sin pedidos registrados</p>
              <p className="text-border text-xs mt-1">Creá el primer pedido para este cliente</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Nº Pedido</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Estado</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Fecha</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Acción</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{o.order_number}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] ?? 'bg-gray-50 text-gray-500'}`}>
                        {STATUS_LABELS[o.status] ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(o.created_at).toLocaleDateString('es-AR')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => navigate(`/orders/${o.id}`)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {activeTab === 'stock' && (
        <Section
          title="Stock"
          count={stockItems.length}
          action={
            <button
              onClick={() => navigate('/stock')}
              className="ui-btn-primary px-3 py-1.5 text-xs font-medium rounded-lg"
            >
              + Cargar stock
            </button>
          }
        >
          {stockItems.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">Sin stock registrado</p>
              <p className="text-border text-xs mt-1">Cargá stock para los productos de este cliente</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Producto</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">SKU</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Ubicación</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Disponible</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Reservado</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {stockItems.map((s, idx) => (
                  <tr key={`${s.product_id}-${s.location_code}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{s.product_name}</td>
                    <td className="px-4 py-3">
                      <span className="bg-gray-50 text-gray-900 px-2 py-0.5 rounded font-mono text-xs">{s.sku}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">{s.location_code}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{s.quantity_available}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{s.quantity_reserved}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{s.quantity_total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {activeTab === 'ocupacion' && (
        <Section
          title="Ocupación mensual"
          count={storageRecords.length}
          action={
            <button
              onClick={openCreateStorageModal}
              className="ui-btn-primary px-3 py-1.5 text-xs font-medium rounded-lg"
            >
              + Cargar ocupación
            </button>
          }
        >
          {!currentStorageRecord && (
            <div className="mx-4 mt-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
              <p className="text-sm font-semibold text-yellow-800">Falta cargar la ocupación de este mes</p>
              <p className="text-sm text-yellow-800 mt-1">
                Registrá el m3 de {formatPeriodLabel(currentPeriod)} para que el cliente entre en la facturación automática.
              </p>
            </div>
          )}

          {storageRecords.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">Sin ocupaciones registradas</p>
              <p className="text-border text-xs mt-1">Cargá el primer m3 mensual para este cliente</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Período</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">m3</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Actualizado</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {storageRecords.map((record) => (
                  <tr key={record.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{formatPeriodLabel(record.period)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{record.storage_m3.toFixed(3)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(record.updated_at).toLocaleString('es-AR')}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditStorageModal(record)}
                          className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-50 transition"
                        >
                          Editar
                        </button>
                        <button
                          onClick={async () => {
                            if (!window.confirm(`¿Eliminar la ocupación de ${formatPeriodLabel(record.period)}?`)) return;
                            setStorageError('');
                            try {
                              await deleteClientStorageRecord(record.id);
                              await reloadStorageRecords();
                              setSuccessMessage('Ocupación eliminada.');
                            } catch (err: unknown) {
                              setStorageError(getApiErrorMessage(err, 'No se pudo eliminar la ocupación.'));
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-50 transition"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {storageError && (
            <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {storageError}
            </div>
          )}
        </Section>
      )}

      {/* Zona de peligro */}
      <div className="mt-6">
        <div className="border border-red-200 rounded-xl">
          <div className="px-6 py-4 border-b border-red-200">
            <h3 className="text-sm font-bold text-red-700">Zona de peligro</h3>
          </div>
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Eliminar cliente</p>
              <p className="text-xs text-gray-500 mt-0.5">Se eliminará permanentemente el cliente y todos sus datos asociados.</p>
            </div>
            <button
              onClick={() => setConfirmDelete(true)}
              className="shrink-0 px-4 py-2 text-sm font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition"
            >
              Eliminar cliente
            </button>
          </div>
        </div>
      </div>

      {/* Modal confirmar eliminación */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Eliminar cliente</h3>
            <p className="text-sm text-gray-500 mb-5">
              ¿Seguro que querés eliminar este cliente? Esta acción no se puede deshacer.
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
                onClick={async () => {
                  setDeleteLoading(true);
                  setDeleteError('');
                  try {
                    await deleteClient(parseInt(id!));
                    navigate('/clients', { replace: true });
                  } catch (err: unknown) {
                    const msg =
                      (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
                      'Error al eliminar cliente';
                    setDeleteError(msg);
                  } finally {
                    setDeleteLoading(false);
                  }
                }}
                disabled={deleteLoading}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {deleteLoading ? 'Eliminando...' : 'Confirmar eliminación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {storageModalOpen && client && (
        <StorageRecordModal
          client={client}
          editingRecord={storageEditing}
          form={storageForm}
          saving={storageSaving}
          error={storageError}
          onClose={() => {
            setStorageModalOpen(false);
            setStorageEditing(null);
            setStorageError('');
          }}
          onChange={(field, value) => setStorageForm((current) => ({ ...current, [field]: value }))}
          onSubmit={async () => {
            if (!id) return;
            setStorageSaving(true);
            setStorageError('');
            try {
              if (storageEditing) {
                await updateClientStorageRecord(storageEditing.id, {
                  storage_m3: Number(storageForm.storage_m3),
                });
                setSuccessMessage('Ocupación actualizada.');
              } else {
                await createClientStorageRecord({
                  client_id: Number(id),
                  period: storageForm.period,
                  storage_m3: Number(storageForm.storage_m3),
                });
                setSuccessMessage('Ocupación cargada correctamente.');
              }
              await reloadStorageRecords();
              setStorageModalOpen(false);
              setStorageEditing(null);
            } catch (err: unknown) {
              setStorageError(getApiErrorMessage(err, 'No se pudo guardar la ocupación.'));
            } finally {
              setStorageSaving(false);
            }
          }}
        />
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {count !== undefined && (
          <span className="bg-gray-50 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">{count}</span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-2 py-2">{children}</div>
    </div>
  );
}

function StorageRecordModal({
  client,
  editingRecord,
  form,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  client: Client;
  editingRecord: ClientStorageRecord | null;
  form: { period: string; storage_m3: string };
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (field: 'period' | 'storage_m3', value: string) => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-y-auto max-h-[calc(100vh-2rem)]">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {editingRecord ? 'Editar ocupación mensual' : 'Cargar ocupación mensual'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">Cliente: {client.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Período</label>
            <input
              type="month"
              value={form.period}
              onChange={(e) => onChange('period', e.target.value)}
              disabled={Boolean(editingRecord)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Ocupación (m3)</label>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={form.storage_m3}
              onChange={(e) => onChange('storage_m3', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
              placeholder="Ej: 12.450"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="pt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || !form.period || !form.storage_m3}
              onClick={() => onSubmit().catch(() => {})}
              className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando...' : editingRecord ? 'Guardar cambios' : 'Guardar ocupación'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatPeriodLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  });
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
    fallback
  );
}
