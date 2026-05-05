import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchClient, updateClient, type Client, type ClientUpdatePayload } from '../services/clients';

const PLAN_OPTIONS = [
  { value: 'basic', label: 'Básico' },
  { value: 'professional', label: 'Profesional' },
  { value: 'enterprise', label: 'Enterprise' },
];

export default function ClientEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [plan, setPlan] = useState('basic');
  const [storageMode, setStorageMode] = useState<'fixed' | 'variable'>('fixed');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchClient(parseInt(id))
      .then((data) => {
        setClient(data);
        setName(data.name);
        setContactEmail(data.contact_email);
        setBusinessName(data.business_name ?? '');
        setTaxId(data.tax_id ?? '');
        setContactPhone(data.contact_phone ?? '');
        setPlan(data.plan);
        setStorageMode(data.variable_storage_enabled ? 'variable' : 'fixed');
      })
      .catch(() => setError('Error al cargar el cliente'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !client) return;

    setError('');
    setSuccess('');
    setSaving(true);

    const payload: ClientUpdatePayload = {
      name,
      contact_email: contactEmail,
      business_name: businessName || undefined,
      tax_id: taxId || undefined,
      contact_phone: contactPhone || undefined,
      plan,
      variable_storage_enabled: storageMode === 'variable',
    };

    try {
      await updateClient(parseInt(id), payload);
      setSuccess('Cliente actualizado correctamente');
      setTimeout(() => navigate(`/clients/${id}`), 1000);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al actualizar el cliente';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Cargando...</div>;
  }

  if (error && !client) {
    return (
      <div className="text-center py-12">
        <p className="text-red-700 mb-4">{error}</p>
        <button onClick={() => navigate('/clients')} className="text-blue-700 hover:underline text-sm">
          Volver a clientes
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(`/clients/${id}`)}
          className="text-gray-500 hover:text-gray-500 transition text-lg"
        >
          &larr;
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Editar cliente</h1>
          <p className="text-gray-500 text-sm mt-0.5">{client?.name}</p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3 mb-4">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nombre</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Email de contacto</label>
            <input
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Razón social</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              placeholder="Opcional"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">CUIT</label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="XX-XXXXXXXX-X"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Teléfono</label>
              <input
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                placeholder="+54..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Plan</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white transition"
            >
              {PLAN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Modo de almacenamiento</h3>
              <p className="text-xs text-gray-500 mt-1">
                Elegí si este cliente se factura con almacenamiento fijo mensual o variable según stock.
              </p>
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900">
              <input
                type="radio"
                name="storage-mode"
                value="fixed"
                checked={storageMode === 'fixed'}
                onChange={() => setStorageMode('fixed')}
                className="mt-0.5 h-4 w-4 border-gray-300 text-blue-700 focus:ring-blue-500"
              />
              <span>
                <span className="block font-semibold">Almacenamiento fijo mensual</span>
                <span className="block text-xs text-gray-500 mt-1">
                  Usa un m3 fijo cargado para el período. Ideal para clientes con abono o valor pactado mensual.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900">
              <input
                type="radio"
                name="storage-mode"
                value="variable"
                checked={storageMode === 'variable'}
                onChange={() => setStorageMode('variable')}
                className="mt-0.5 h-4 w-4 border-gray-300 text-blue-700 focus:ring-blue-500"
              />
              <span>
                <span className="block font-semibold">Almacenamiento variable por stock</span>
                <span className="block text-xs text-gray-500 mt-1">
                  Cobra el almacenamiento día a día según el stock real y los m3 cargados por producto o caja.
                </span>
              </span>
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate(`/clients/${id}`)}
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
      </div>
    </div>
  );
}
