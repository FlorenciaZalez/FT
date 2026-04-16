import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClients } from '../hooks/useClients';
import { useAuth } from '../auth/AuthContext';
import { fetchOrders, type Order } from '../services/orders';
import { fetchStock, type StockItem } from '../services/stock';
import type { Client, ClientCreatePayload, ClientUpdatePayload } from '../services/clients';

type StatusFilter = 'all' | 'active' | 'inactive';

const BILLING_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1);

function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string') return item.msg;
        return null;
      })
      .filter((item): item is string => Boolean(item));

    if (messages.length > 0) {
      return messages.join('. ');
    }
  }

  return fallback;
}

function formatLastActivity(iso: string | undefined): string {
  if (!iso) return 'Sin actividad';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays <= 30) return `Hace ${diffDays} días`;
  return date.toLocaleDateString('es-AR');
}

export default function Clients() {
  const { clients, loading, error, add, update, toggleActive } = useClients();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<Client | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');

  // Extra data for table columns
  const [orders, setOrders] = useState<Order[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

  useEffect(() => {
    fetchOrders().then(setOrders).catch(() => {});
    fetchStock().then(setStockItems).catch(() => {});
  }, []);

  const orderCountMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const o of orders) {
      map.set(o.client_id, (map.get(o.client_id) ?? 0) + 1);
    }
    return map;
  }, [orders]);

  const lastOrderDateMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const o of orders) {
      const current = map.get(o.client_id);
      if (!current || o.created_at > current) {
        map.set(o.client_id, o.created_at);
      }
    }
    return map;
  }, [orders]);

  const stockCountMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of stockItems) {
      map.set(s.client_id, (map.get(s.client_id) ?? 0) + s.quantity);
    }
    return map;
  }, [stockItems]);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    let list = clients;
    if (statusFilter === 'active') list = list.filter((c) => c.is_active);
    if (statusFilter === 'inactive') list = list.filter((c) => !c.is_active);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.contact_email.toLowerCase().includes(q) ||
          (c.contact_name ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [clients, search, statusFilter]);

  const handleToggle = async (client: Client) => {
    setActionError('');
    setActionLoading(client.id);
    try {
      await toggleActive(client.id, client.is_active);
      setConfirmToggle(null);
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Error al cambiar estado');
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-500 text-sm mt-1">Gestioná los clientes del depósito</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
          >
            + Nuevo cliente
          </button>
        )}
      </div>

      {showForm && (
        <CreateClientForm
          onCreated={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
          addClient={add}
        />
      )}

      {(error || actionError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          {error || actionError}
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-sm"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando clientes...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {clients.length === 0 ? 'No hay clientes registrados' : 'No se encontraron resultados'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0 table-scroll-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Nombre</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Pedidos</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Última actividad</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Stock</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Cobro</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estado</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  className={`border-b border-gray-200 cursor-pointer ${
                    c.is_active ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100 opacity-60'
                  }`}
                >
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    {c.contact_name && (
                      <div className="text-xs text-gray-500 mt-0.5">Operativo: {c.contact_name}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-gray-900">{orderCountMap.get(c.id) ?? 0}</td>
                  <td className="px-6 py-4 text-gray-500 text-xs">{formatLastActivity(lastOrderDateMap.get(c.id))}</td>
                  <td className="px-6 py-4 text-right text-gray-500">{(stockCountMap.get(c.id) ?? 0)} items</td>
                  <td className="px-6 py-4 text-gray-500 text-xs">
                    {c.billing_schedule?.active ? `Día ${c.billing_schedule.day_of_month}` : 'Sin definir'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {c.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => navigate(`/clients/${c.id}`)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-50 transition"
                      >
                        Ver
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => setEditingClient(c)}
                            className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-50 transition"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => setConfirmToggle(c)}
                            disabled={actionLoading === c.id}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-50 ${
                              c.is_active
                                ? 'text-red-700 bg-red-50 hover:bg-red-50'
                                : 'text-green-700 bg-green-50 hover:bg-green-50'
                            }`}
                          >
                            {actionLoading === c.id ? '...' : c.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm toggle */}
      {confirmToggle && (
        <ConfirmModal
          title={confirmToggle.is_active ? 'Desactivar cliente' : 'Activar cliente'}
          message={
            confirmToggle.is_active
              ? `¿Estás seguro de desactivar "${confirmToggle.name}"? Sus productos y pedidos seguirán existiendo pero no podrá operar.`
              : `¿Querés reactivar "${confirmToggle.name}"?`
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
      {editingClient && (
        <EditClientModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSaved={() => setEditingClient(null)}
          updateClient={update}
        />
      )}

    </div>
  );
}

/* ─── Confirm Modal ─── */
function ConfirmModal({
  title, message, confirmLabel, confirmColor, loading, onConfirm, onCancel, error,
}: {
  title: string; message: string; confirmLabel: string; confirmColor: 'red' | 'green';
  loading: boolean; onConfirm: () => void; onCancel: () => void; error?: string;
}) {
  const colorClass = confirmColor === 'red'
    ? 'bg-red-600 hover:opacity-90 text-white'
    : 'bg-green-600 hover:opacity-90 text-white';

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-5">{message}</p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={loading} className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ${colorClass}`}>
            {loading ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Client Modal ─── */
function EditClientModal({
  client, onClose, onSaved, updateClient,
}: {
  client: Client; onClose: () => void; onSaved: () => void;
  updateClient: (id: number, p: ClientUpdatePayload) => Promise<Client>;
}) {
  const [name, setName] = useState(client.name);
  const [contactEmail, setContactEmail] = useState(client.contact_email);
  const [businessName, setBusinessName] = useState(client.business_name ?? '');
  const [taxId, setTaxId] = useState(client.tax_id ?? '');
  const [contactPhone, setContactPhone] = useState(client.contact_phone ?? '');
  const [contactName, setContactName] = useState(client.contact_name ?? '');
  const [contactPhoneOperational, setContactPhoneOperational] = useState(client.contact_phone_operational ?? '');
  const [plan, setPlan] = useState(client.plan);
  const [billingDayOfMonth, setBillingDayOfMonth] = useState(
    String(client.billing_schedule?.day_of_month ?? 5),
  );
  const [variableStorageEnabled, setVariableStorageEnabled] = useState(client.variable_storage_enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await updateClient(client.id, {
        name,
        contact_email: contactEmail,
        business_name: businessName || undefined,
        tax_id: taxId || undefined,
        contact_phone: contactPhone || undefined,
        contact_name: contactName || undefined,
        contact_phone_operational: contactPhoneOperational || undefined,
        plan,
        billing_day_of_month: Number(billingDayOfMonth),
        variable_storage_enabled: variableStorageEnabled,
      });
      onSaved();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al actualizar cliente';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Editar cliente</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        {formError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{formError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nombre</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Email de contacto</label>
            <input type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Razón social</label>
            <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Empresa S.A." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">CUIT</label>
              <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="XX-XXXXXXXX-X" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Teléfono</label>
              <input type="text" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="+54..." />
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Contacto operativo</h3>
              <p className="text-xs text-gray-500 mt-1">Separado del teléfono principal para la operatoria diaria.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Nombre del contacto</label>
                <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Nombre y apellido" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Teléfono del contacto</label>
                <input type="text" value={contactPhoneOperational} onChange={(e) => setContactPhoneOperational(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="+54..." />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Plan</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
              <option value="basic">Básico</option>
              <option value="professional">Profesional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Día de cobro</label>
            <select
              value={billingDayOfMonth}
              onChange={(e) => setBillingDayOfMonth(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              {BILLING_DAY_OPTIONS.map((day) => (
                <option key={day} value={day}>
                  Día {day}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <label className="flex items-start gap-3 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={variableStorageEnabled}
                onChange={(e) => setVariableStorageEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-200 text-blue-700 focus:ring-blue-500"
              />
              <span>
                <span className="block font-semibold">Almacenamiento variable</span>
                <span className="block text-xs text-gray-500 mt-1">
                  Calcula los m3 automáticamente según el stock y las medidas de las cajas.
                </span>
              </span>
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Create Client Form ─── */
function CreateClientForm({
  onCreated, onCancel, addClient,
}: {
  onCreated: () => void; onCancel: () => void;
  addClient: (p: ClientCreatePayload) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhoneOperational, setContactPhoneOperational] = useState('');
  const [billingDayOfMonth, setBillingDayOfMonth] = useState('5');
  const [variableStorageEnabled, setVariableStorageEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await addClient({
        name,
        contact_email: contactEmail,
        business_name: businessName || undefined,
        tax_id: taxId || undefined,
        contact_phone: contactPhone || undefined,
        contact_name: contactName || undefined,
        contact_phone_operational: contactPhoneOperational || undefined,
        billing_day_of_month: Number(billingDayOfMonth),
        variable_storage_enabled: variableStorageEnabled,
      });
      onCreated();
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Error al crear cliente');
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Nuevo cliente</h2>
      {formError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{formError}</div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nombre *</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Nombre del cliente" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Email de contacto *</label>
            <input type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="contacto@empresa.com" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Razón social <span className="text-gray-500 font-normal">(opcional)</span></label>
            <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Empresa S.A." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">CUIT <span className="text-gray-500 font-normal">(opcional)</span></label>
            <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="XX-XXXXXXXX-X" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Teléfono <span className="text-gray-500 font-normal">(opcional)</span></label>
            <input type="text" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="+54..." />
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Contacto operativo</h3>
            <p className="text-xs text-gray-500 mt-1">Datos del contacto diario para coordinación operativa.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Nombre del contacto</label>
              <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Nombre y apellido" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Teléfono del contacto</label>
              <input type="text" value={contactPhoneOperational} onChange={(e) => setContactPhoneOperational(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="+54..." />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">Día de cobro</label>
          <select
            value={billingDayOfMonth}
            onChange={(e) => setBillingDayOfMonth(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            {BILLING_DAY_OPTIONS.map((day) => (
              <option key={day} value={day}>
                Día {day}
              </option>
            ))}
          </select>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <label className="flex items-start gap-3 text-sm text-gray-900">
            <input
              type="checkbox"
              checked={variableStorageEnabled}
              onChange={(e) => setVariableStorageEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-200 text-blue-700 focus:ring-blue-500"
            />
            <span>
              <span className="block font-semibold">Almacenamiento variable</span>
              <span className="block text-xs text-gray-500 mt-1">
                Activalo para cobrar almacenamiento según el stock real y los m3 cargados por caja.
              </span>
            </span>
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onCancel}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button type="submit" disabled={saving}
            className="ui-btn-primary px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
