import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  createHandlingRate,
  createPostalCodeRange,
  createShippingRate,
  deletePostalCodeRange,
  fetchHandlingRates,
  fetchPostalCodeRanges,
  fetchShippingRates,
  updateHandlingRate,
  updatePostalCodeRange,
  updateShippingRate,
  type HandlingRate,
  type PostalCodeRange,
  type ShippingCordon,
  type ShippingRate,
  type ShippingWeightCategory,
} from '../services/shipping';
import SuccessToast from '../components/SuccessToast';

const CORDON_OPTIONS: Array<{ value: ShippingCordon; label: string }> = [
  { value: 'cordon_1', label: 'Cordón 1' },
  { value: 'cordon_2', label: 'Cordón 2' },
  { value: 'cordon_3', label: 'Cordón 3' },
];

const WEIGHT_CATEGORY_OPTIONS: Array<{ value: ShippingWeightCategory; label: string }> = [
  { value: 'light', label: 'Liviano' },
  { value: 'heavy', label: 'Pesado' },
];

function getCordonLabel(value: ShippingCordon): string {
  return CORDON_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function createEmptyShippingDraft(): Record<ShippingCordon, string> {
  return {
    cordon_1: '',
    cordon_2: '',
    cordon_3: '',
  };
}

function createEmptyHandlingDraft(): Record<ShippingWeightCategory, string> {
  return {
    light: '',
    heavy: '',
  };
}

export default function ShippingRules() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [ranges, setRanges] = useState<PostalCodeRange[]>([]);
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [handlingRates, setHandlingRates] = useState<HandlingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [editingRange, setEditingRange] = useState<PostalCodeRange | null>(null);

  const [rangeSearch, setRangeSearch] = useState('');
  const [shippingDraft, setShippingDraft] = useState<Record<ShippingCordon, string>>(createEmptyShippingDraft);
  const [handlingDraft, setHandlingDraft] = useState<Record<ShippingWeightCategory, string>>(createEmptyHandlingDraft);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [rangesData, shippingRatesData, handlingRatesData] = await Promise.all([
        fetchPostalCodeRanges(),
        fetchShippingRates(),
        fetchHandlingRates(),
      ]);
      setRanges(rangesData);
      setShippingRates(shippingRatesData);
      setHandlingRates(handlingRatesData);
      setShippingDraft({
        cordon_1: shippingRatesData.find((item) => item.cordon === 'cordon_1')?.price.toString() ?? '',
        cordon_2: shippingRatesData.find((item) => item.cordon === 'cordon_2')?.price.toString() ?? '',
        cordon_3: shippingRatesData.find((item) => item.cordon === 'cordon_3')?.price.toString() ?? '',
      });
      setHandlingDraft({
        light: handlingRatesData.find((item) => item.weight_category === 'light')?.price.toString() ?? '',
        heavy: handlingRatesData.find((item) => item.weight_category === 'heavy')?.price.toString() ?? '',
      });
    } catch {
      setError('No se pudieron cargar las reglas logísticas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadData().catch(() => {});
  }, [isAdmin]);

  const filteredRanges = useMemo(() => {
    const q = rangeSearch.trim().toLowerCase();
    if (!q) return ranges;
    return ranges.filter((item) => getCordonLabel(item.cordon).toLowerCase().includes(q) || String(item.cp_from).includes(q) || String(item.cp_to).includes(q));
  }, [ranges, rangeSearch]);

  const shippingRatesByCordon = useMemo(() => {
    const mapped = new Map<ShippingCordon, ShippingRate>();
    for (const rate of shippingRates) {
      mapped.set(rate.cordon, rate);
    }
    return mapped;
  }, [shippingRates]);

  const handlingRatesByCategory = useMemo(() => {
    const mapped = new Map<ShippingWeightCategory, HandlingRate>();
    for (const rate of handlingRates) {
      mapped.set(rate.weight_category, rate);
    }
    return mapped;
  }, [handlingRates]);

  const missingShippingCordons = useMemo(
    () => CORDON_OPTIONS.filter((option) => !shippingRatesByCordon.has(option.value)),
    [shippingRatesByCordon],
  );

  const missingHandlingCategories = useMemo(
    () => WEIGHT_CATEGORY_OPTIONS.filter((option) => !handlingRatesByCategory.has(option.value)),
    [handlingRatesByCategory],
  );

  const handleDeleteRange = async (item: PostalCodeRange) => {
    if (!window.confirm(`Eliminar el rango ${item.cp_from}-${item.cp_to} (${item.cordon})?`)) return;
    setError('');
    try {
      await deletePostalCodeRange(item.id);
      setRanges((current) => current.filter((row) => row.id !== item.id));
      setSuccessMessage('Rango postal eliminado.');
    } catch {
      setError('No se pudo eliminar el rango postal.');
    }
  };

  const handleSaveConfiguration = async () => {
    const shippingPayload = CORDON_OPTIONS.map((option) => ({
      cordon: option.value,
      price: shippingDraft[option.value],
    }));
    const handlingPayload = WEIGHT_CATEGORY_OPTIONS.map((option) => ({
      weight_category: option.value,
      price: handlingDraft[option.value],
    }));

    const hasMissingShipping = shippingPayload.some((item) => item.price.trim() === '');
    const hasMissingHandling = handlingPayload.some((item) => item.price.trim() === '');
    if (hasMissingShipping || hasMissingHandling) {
      setError('Completá las 3 tarifas de envío y las 2 tarifas de preparación antes de guardar.');
      return;
    }

    const normalizedShipping = shippingPayload.map((item) => ({ ...item, value: Number(item.price) }));
    const normalizedHandling = handlingPayload.map((item) => ({ ...item, value: Number(item.price) }));
    if (
      normalizedShipping.some((item) => !Number.isFinite(item.value) || item.value < 0) ||
      normalizedHandling.some((item) => !Number.isFinite(item.value) || item.value < 0)
    ) {
      setError('Todos los importes deben ser números válidos mayores o iguales a 0.');
      return;
    }

    setSavingConfig(true);
    setError('');
    try {
      await Promise.all([
        ...normalizedShipping.map((item) => {
          const existing = shippingRatesByCordon.get(item.cordon);
          if (existing) {
            return updateShippingRate(existing.id, { price: item.value });
          }
          return createShippingRate({ cordon: item.cordon, price: item.value });
        }),
        ...normalizedHandling.map((item) => {
          const existing = handlingRatesByCategory.get(item.weight_category);
          if (existing) {
            return updateHandlingRate(existing.id, { price: item.value });
          }
          return createHandlingRate({ weight_category: item.weight_category, price: item.value });
        }),
      ]);
      await loadData();
      setSuccessMessage('Configuración logística guardada.');
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo guardar la configuración logística.';
      setError(message);
    } finally {
      setSavingConfig(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Tarifas de envío</h1>
        <p className="text-sm text-gray-500 mt-2">Esta sección está disponible solo para administradores.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tarifas de envío</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configurá el costo logístico separando envío por cordón y preparación por categoría de peso.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => { setEditingRange(null); setShowRangeModal(true); }}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            + Nuevo rango postal
          </button>
          <button
            onClick={() => { handleSaveConfiguration().catch(() => {}); }}
            disabled={loading || savingConfig}
            className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {savingConfig ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {(missingShippingCordons.length > 0 || missingHandlingCategories.length > 0) && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-lg p-4">
          <div className="font-semibold">Faltan tarifas clave para completar la configuración.</div>
          {missingShippingCordons.length > 0 && (
            <div className="mt-1">Envío sin tarifa: {missingShippingCordons.map((item) => item.label).join(', ')}.</div>
          )}
          {missingHandlingCategories.length > 0 && (
            <div className="mt-1">Preparación sin tarifa: {missingHandlingCategories.map((item) => item.label).join(', ')}.</div>
          )}
        </div>
      )}

      {successMessage && <SuccessToast message={successMessage} onClose={() => setSuccessMessage('')} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Rangos configurados" value={String(ranges.length)} tone="blue" />
        <SummaryCard label="Envío configurado" value={`${shippingRates.length} / 3`} tone="emerald" />
        <SummaryCard label="Preparación configurada" value={`${handlingRates.length} / 2`} tone="amber" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Tarifas de envío</h2>
            <p className="text-sm text-gray-500 mt-1">Cada cordón tiene un único costo base de envío.</p>
          </div>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-3 font-medium">Cordón</th>
                    <th className="pb-3 font-medium text-right">Precio de envío</th>
                  </tr>
                </thead>
                <tbody>
                  {CORDON_OPTIONS.map((option) => (
                    <tr key={option.value} className="border-b border-gray-200 last:border-b-0">
                      <td className="py-4 font-medium text-gray-900">{option.label}</td>
                      <td className="py-4">
                        <div className="flex justify-end">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={shippingDraft[option.value]}
                            onChange={(e) => setShippingDraft((current) => ({ ...current, [option.value]: e.target.value }))}
                            className="w-40 px-4 py-2.5 border border-gray-200 rounded-lg text-right"
                            placeholder="0.00"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Tarifas de preparación</h2>
            <p className="text-sm text-gray-500 mt-1">La preparación depende de si el pedido resulta liviano o pesado.</p>
          </div>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-3 font-medium">Categoría</th>
                    <th className="pb-3 font-medium text-right">Precio de preparación</th>
                  </tr>
                </thead>
                <tbody>
                  {WEIGHT_CATEGORY_OPTIONS.map((option) => (
                    <tr key={option.value} className="border-b border-gray-200 last:border-b-0">
                      <td className="py-4 font-medium text-gray-900">{option.label}</td>
                      <td className="py-4">
                        <div className="flex justify-end">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={handlingDraft[option.value]}
                            onChange={(e) => setHandlingDraft((current) => ({ ...current, [option.value]: e.target.value }))}
                            className="w-40 px-4 py-2.5 border border-gray-200 rounded-lg text-right"
                            placeholder="0.00"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900">
              Total calculado por pedido = envío por cordón + preparación por categoría de peso.
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden xl:col-span-2">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Rangos postales</h2>
              <p className="text-sm text-gray-500 mt-1">Definen qué cordón corresponde a cada código postal.</p>
            </div>
            <input
              type="text"
              value={rangeSearch}
              onChange={(e) => setRangeSearch(e.target.value)}
              placeholder="Buscar por cordón o CP..."
              className="w-full sm:w-64 px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
            />
          </div>
          {loading ? (
            <div className="p-6 text-center text-gray-500">Cargando rangos...</div>
          ) : filteredRanges.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No hay rangos para mostrar.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Desde</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Hasta</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Cordón</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRanges.map((item) => (
                    <tr key={item.id} className="border-b border-gray-200 last:border-b-0">
                      <td className="px-6 py-4 font-medium text-gray-900">{item.cp_from}</td>
                      <td className="px-4 py-4 text-gray-500">{item.cp_to}</td>
                      <td className="px-4 py-4">
                        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{getCordonLabel(item.cordon)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => { setEditingRange(item); setShowRangeModal(true); }}
                            className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => { handleDeleteRange(item).catch(() => {}); }}
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
            </div>
          )}
        </section>
      </div>

      {showRangeModal && (
        <PostalCodeRangeModal
          item={editingRange}
          onClose={() => { setShowRangeModal(false); setEditingRange(null); }}
          onSaved={(item, isEdit) => {
            setRanges((current) => {
              if (isEdit) return current.map((row) => (row.id === item.id ? item : row));
              return [...current, item].sort((a, b) => a.cp_from - b.cp_from);
            });
            setShowRangeModal(false);
            setEditingRange(null);
            setSuccessMessage(isEdit ? 'Rango postal actualizado.' : 'Rango postal creado.');
          }}
        />
      )}
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

function PostalCodeRangeModal({
  item,
  onClose,
  onSaved,
}: {
  item: PostalCodeRange | null;
  onClose: () => void;
  onSaved: (item: PostalCodeRange, isEdit: boolean) => void;
}) {
  const isEdit = !!item;
  const [cpFrom, setCpFrom] = useState(item?.cp_from.toString() ?? '');
  const [cpTo, setCpTo] = useState(item?.cp_to.toString() ?? '');
  const [cordon, setCordon] = useState<ShippingCordon>(item?.cordon ?? 'cordon_1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedFrom = Number(cpFrom);
    const normalizedTo = Number(cpTo);
    if (!Number.isInteger(normalizedFrom) || !Number.isInteger(normalizedTo) || normalizedFrom < 0 || normalizedTo < 0) {
      setError('Los códigos postales deben ser números enteros válidos.');
      return;
    }
    if (normalizedFrom > normalizedTo) {
      setError('El CP desde no puede ser mayor que el CP hasta.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { cp_from: normalizedFrom, cp_to: normalizedTo, cordon };
      const result = isEdit
        ? await updatePostalCodeRange(item!.id, payload)
        : await createPostalCodeRange(payload);
      onSaved(result, isEdit);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo guardar el rango postal.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-y-auto max-h-[calc(100vh-2rem)]">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Editar rango postal' : 'Nuevo rango postal'}</h2>
            <p className="text-sm text-gray-500 mt-1">Asigná un cordón a un rango continuo de códigos postales.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <form onSubmit={(event) => { handleSubmit(event).catch(() => {}); }} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="CP desde">
              <input type="number" min={0} value={cpFrom} onChange={(e) => setCpFrom(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg" />
            </FormField>
            <FormField label="CP hasta">
              <input type="number" min={0} value={cpTo} onChange={(e) => setCpTo(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg" />
            </FormField>
          </div>

          <FormField label="Cordón">
            <select value={cordon} onChange={(e) => setCordon(e.target.value as ShippingCordon)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white">
              {CORDON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>

          <div className="pt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition">Cancelar</button>
            <button type="submit" disabled={saving} className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar rango'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      {children}
    </div>
  );
}