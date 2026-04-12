import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import SuccessToast from '../components/SuccessToast';
import { fetchClients, type Client } from '../services/clients';
import {
  createManualCharge,
  deleteManualCharge,
  fetchBillingAlerts,
  fetchBillingDocuments,
  fetchBillingPreview,
  fetchClientBillingRates,
  fetchGlobalBillingRates,
  fetchManualCharges,
  generateBillingDocuments,
  generateSingleBillingDocument,
  markBillingDocumentPaid,
  updateClientBillingRates,
  updateGlobalBillingRates,
  type BillingAlertSummary,
  type BillingDocument,
  type BillingPreviewItem,
  type ClientRate,
  type ManualCharge,
} from '../services/billing';
import { formatCurrency, formatNumber, getChargeStatusClasses, getCurrentPeriod, toFiniteNumber } from '../utils/billingFormat';

type EditableClientRate = {
  client_id: number;
  storage_discount_pct: string;
  shipping_discount_pct: string;
};

type DocumentStatusFilter = 'all' | 'pending' | 'paid' | 'overdue';

export default function Billing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const isClient = user?.role === 'client';

  const [period, setPeriod] = useState(getCurrentPeriod());
  const [preview, setPreview] = useState<BillingPreviewItem[]>([]);
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [alerts, setAlerts] = useState<BillingAlertSummary>({
    due_soon_count: 0,
    due_soon_days: 2,
    overdue_count: 0,
    due_soon_documents: [],
    overdue_documents: [],
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [documentStatus, setDocumentStatus] = useState<DocumentStatusFilter>('all');
  const [documentClientId, setDocumentClientId] = useState('');
  const [globalRatesForm, setGlobalRatesForm] = useState({
    storage_per_m3: '0',
    preparation_base_fee: '0',
    preparation_additional_fee: '0',
    product_creation_fee: '0',
    transport_dispatch_fee: '0',
    truck_unloading_fee: '0',
    shipping_base: '0',
  });
  const [clientRates, setClientRates] = useState<ClientRate[]>([]);
  const [manualCharges, setManualCharges] = useState<ManualCharge[]>([]);
  const [clientRateForms, setClientRateForms] = useState<Record<number, EditableClientRate>>({});
  const [loading, setLoading] = useState(true);
  const [savingGlobalRates, setSavingGlobalRates] = useState(false);
  const [savingClientId, setSavingClientId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingClientId, setGeneratingClientId] = useState<number | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showGlobalRatesModal, setShowGlobalRatesModal] = useState(false);
  const [showClientRatesModal, setShowClientRatesModal] = useState(false);
  const [showManualChargeModal, setShowManualChargeModal] = useState(false);
  const [expandedPreviewClientId, setExpandedPreviewClientId] = useState<number | null>(null);
  const [globalRatesSeenAt, setGlobalRatesSeenAt] = useState('');
  const [savingManualCharge, setSavingManualCharge] = useState(false);
  const [deletingManualChargeId, setDeletingManualChargeId] = useState<number | null>(null);
  const [manualChargeForm, setManualChargeForm] = useState({
    client_id: '',
    monto: '',
    tipo: '',
    descripcion: '',
    fecha: new Date().toISOString().slice(0, 10),
  });

  const missingStorageItems = useMemo(
    () => preview.filter((item) => item.missing_storage),
    [preview],
  );
  const canGenerateDocuments = missingStorageItems.length === 0;
  const periodStatus = canGenerateDocuments ? 'Listo para facturar' : 'Pendiente de revisión';

  const totals = useMemo(() => {
    return preview.reduce(
      (acc, item) => ({
        total: acc.total + toFiniteNumber(item.total),
        totalM3: acc.totalM3 + toFiniteNumber(item.total_m3),
        totalOrders: acc.totalOrders + Math.trunc(toFiniteNumber(item.total_orders)),
        totalShippingAmount: acc.totalShippingAmount + toFiniteNumber(item.shipping_amount),
      }),
      { total: 0, totalM3: 0, totalOrders: 0, totalShippingAmount: 0 },
    );
  }, [preview]);

  const documentTotals = useMemo(() => {
    return documents.reduce(
      (acc, item) => ({
        total: acc.total + item.total,
        pending: acc.pending + (item.status === 'pending' ? 1 : 0),
        paid: acc.paid + (item.status === 'paid' ? 1 : 0),
        overdue: acc.overdue + (item.status === 'overdue' ? 1 : 0),
      }),
      { total: 0, pending: 0, paid: 0, overdue: 0 },
    );
  }, [documents]);

  const manualChargeTotals = useMemo(
    () => manualCharges.reduce(
      (acc, item) => ({
        count: acc.count + 1,
        total: acc.total + toFiniteNumber(item.monto),
      }),
      { count: 0, total: 0 },
    ),
    [manualCharges],
  );

  const loadBillingData = async (
    targetPeriod: string,
    targetStatus: DocumentStatusFilter,
    targetClientId: string,
  ) => {
    setLoading(true);
    setError('');
    try {
      const documentClient = targetClientId ? Number(targetClientId) : undefined;
      const [previewData, documentsData, alertsData] = await Promise.all([
        fetchBillingPreview(targetPeriod),
        fetchBillingDocuments({
          period: targetPeriod,
          client_id: documentClient,
          status: targetStatus === 'all' ? undefined : targetStatus,
        }),
        fetchBillingAlerts(),
      ]);

      setPreview(previewData);
      setDocuments(documentsData);
      setAlerts(alertsData);

      if (isAdmin) {
        const [ratesData, clientRatesData, clientsData, manualChargesData] = await Promise.all([
          fetchGlobalBillingRates(),
          fetchClientBillingRates(),
          fetchClients(),
          fetchManualCharges({ period: targetPeriod }),
        ]);
        setGlobalRatesForm({
          storage_per_m3: String(ratesData.storage_per_m3),
          preparation_base_fee: String(ratesData.preparation_base_fee),
          preparation_additional_fee: String(ratesData.preparation_additional_fee),
          product_creation_fee: String(ratesData.product_creation_fee),
          transport_dispatch_fee: String(ratesData.transport_dispatch_fee),
          truck_unloading_fee: String(ratesData.truck_unloading_fee),
          shipping_base: String(ratesData.shipping_base),
        });
        setGlobalRatesSeenAt(new Date().toISOString());
        setClientRates(clientRatesData);
        setManualCharges(manualChargesData);
        setClients(clientsData.filter((client) => client.is_active));
        setClientRateForms(
          Object.fromEntries(
            clientRatesData.map((item) => [
              item.client_id,
              {
                client_id: item.client_id,
                storage_discount_pct: item.storage_discount_pct?.toString() ?? '',
                shipping_discount_pct: item.shipping_discount_pct?.toString() ?? '',
              },
            ]),
          ),
        );
      }
    } catch {
      setError('No se pudo cargar la información de facturación.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBillingData(period, documentStatus, documentClientId).catch(() => {});
  }, [period, documentStatus, documentClientId, isAdmin]);

  const handleRefreshBilling = async () => {
    await loadBillingData(period, documentStatus, documentClientId);
    setSuccessMessage('Facturación recalculada.');
  };

  const handleSaveGlobalRates = async (event: FormEvent) => {
    event.preventDefault();
    const storagePerM3 = Number(globalRatesForm.storage_per_m3);
    const preparationBaseFee = Number(globalRatesForm.preparation_base_fee);
    const preparationAdditionalFee = Number(globalRatesForm.preparation_additional_fee);
    const productCreationFee = Number(globalRatesForm.product_creation_fee);
    const transportDispatchFee = Number(globalRatesForm.transport_dispatch_fee);
    const truckUnloadingFee = Number(globalRatesForm.truck_unloading_fee);
    const shippingBase = Number(globalRatesForm.shipping_base);

    if (
      !Number.isFinite(storagePerM3) ||
      !Number.isFinite(preparationBaseFee) ||
      !Number.isFinite(preparationAdditionalFee) ||
      !Number.isFinite(productCreationFee) ||
      !Number.isFinite(transportDispatchFee) ||
      !Number.isFinite(truckUnloadingFee) ||
      !Number.isFinite(shippingBase) ||
      storagePerM3 < 0 ||
      preparationBaseFee < 0 ||
      preparationAdditionalFee < 0 ||
      productCreationFee < 0 ||
      transportDispatchFee < 0 ||
      truckUnloadingFee < 0 ||
      shippingBase < 0
    ) {
      setError('Las tarifas globales deben ser números válidos mayores o iguales a 0.');
      return;
    }

    setSavingGlobalRates(true);
    setError('');
    try {
      await updateGlobalBillingRates({
        storage_per_m3: storagePerM3,
        preparation_base_fee: preparationBaseFee,
        preparation_additional_fee: preparationAdditionalFee,
        product_creation_fee: productCreationFee,
        transport_dispatch_fee: transportDispatchFee,
        truck_unloading_fee: truckUnloadingFee,
        shipping_base: shippingBase,
      });
      setSuccessMessage('Tarifas globales actualizadas.');
      setShowGlobalRatesModal(false);
      await loadBillingData(period, documentStatus, documentClientId);
    } catch {
      setError('No se pudieron guardar las tarifas globales.');
    } finally {
      setSavingGlobalRates(false);
    }
  };

  const handleSaveClientRate = async (clientId: number) => {
    const form = clientRateForms[clientId];
    if (!form) return;
    const storageDiscount = form.storage_discount_pct.trim() === '' ? null : Number(form.storage_discount_pct);
    const shippingDiscount = form.shipping_discount_pct.trim() === '' ? null : Number(form.shipping_discount_pct);
    const values = [storageDiscount, shippingDiscount].filter((value) => value !== null) as number[];
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      setError('Los descuentos del cliente deben ser porcentajes válidos entre 0 y 100.');
      return;
    }
    setSavingClientId(clientId);
    setError('');
    try {
      await updateClientBillingRates(clientId, {
        storage_discount_pct: storageDiscount,
        shipping_discount_pct: shippingDiscount,
      });
      setSuccessMessage('Descuentos del cliente actualizados.');
      await loadBillingData(period, documentStatus, documentClientId);
    } catch {
      setError('No se pudo guardar la configuración del cliente.');
    } finally {
      setSavingClientId(null);
    }
  };

  const handleGenerateDocuments = async () => {
    setGenerating(true);
    setError('');
    try {
      await generateBillingDocuments({ period, overwrite: true });
      setSuccessMessage('Remitos generados correctamente.');
      await loadBillingData(period, documentStatus, documentClientId);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'No se pudieron generar los remitos.'));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateSingleDocument = async (clientId: number) => {
    setGeneratingClientId(clientId);
    setError('');
    try {
      await generateSingleBillingDocument(clientId, { period, overwrite: true });
      setSuccessMessage('Remito generado correctamente.');
      await loadBillingData(period, documentStatus, documentClientId);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'No se pudo generar el remito.'));
    } finally {
      setGeneratingClientId(null);
    }
  };

  const handleMarkPaid = async (documentId: number) => {
    setMarkingPaidId(documentId);
    setError('');
    try {
      await markBillingDocumentPaid(documentId);
      setSuccessMessage('Remito marcado como pagado.');
      await loadBillingData(period, documentStatus, documentClientId);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'No se pudo marcar el remito como pagado.'));
    } finally {
      setMarkingPaidId(null);
    }
  };

  const handleCreateManualCharge = async (event: FormEvent) => {
    event.preventDefault();
    const clientId = Number(manualChargeForm.client_id);
    const amount = Number(manualChargeForm.monto);
    if (!Number.isInteger(clientId) || clientId <= 0 || !Number.isFinite(amount) || amount === 0 || !manualChargeForm.fecha) {
      setError('Completá cliente, fecha y un monto distinto de 0.');
      return;
    }

    setSavingManualCharge(true);
    setError('');
    try {
      await createManualCharge({
        client_id: clientId,
        monto: amount,
        tipo: manualChargeForm.tipo.trim() || undefined,
        descripcion: manualChargeForm.descripcion.trim() || undefined,
        fecha: manualChargeForm.fecha,
        periodo: period,
      });
      setShowManualChargeModal(false);
      setManualChargeForm({
        client_id: '',
        monto: '',
        tipo: '',
        descripcion: '',
        fecha: new Date().toISOString().slice(0, 10),
      });
      setSuccessMessage('Cargo manual registrado.');
      await loadBillingData(period, documentStatus, documentClientId);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'No se pudo guardar el cargo manual.'));
    } finally {
      setSavingManualCharge(false);
    }
  };

  const handleDeleteManualCharge = async (chargeId: number) => {
    setDeletingManualChargeId(chargeId);
    setError('');
    try {
      await deleteManualCharge(chargeId);
      setSuccessMessage('Cargo manual eliminado.');
      await loadBillingData(period, documentStatus, documentClientId);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'No se pudo eliminar el cargo manual.'));
    } finally {
      setDeletingManualChargeId(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Facturación</h1>
            <p className="text-sm text-gray-500 mt-1">
              {isClient ? 'Seguimiento visual del acumulado del período y remitos emitidos.' : 'Estado del período y cierre mensual.'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Período</label>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="px-4 py-2.5 border border-gray-200 rounded-lg bg-white"
              />
            </div>
            {isAdmin && (
              <button
                onClick={() => handleRefreshBilling().catch(() => {})}
                className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Recalcular
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => handleGenerateDocuments().catch(() => {})}
                disabled={generating || !canGenerateDocuments}
                className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {generating ? 'Generando...' : 'Generar remitos'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {successMessage && <SuccessToast message={successMessage} onClose={() => setSuccessMessage('')} />}

      {((isAdmin && missingStorageItems.length > 0) || alerts.due_soon_count > 0 || alerts.overdue_count > 0) && (
        <section className="rounded-2xl border border-yellow-200 bg-yellow-50 px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="text-xl leading-none">⚠</div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-yellow-900">Alertas del período</h2>
              <div className="mt-3 space-y-3 text-sm text-yellow-900">
                {isAdmin && missingStorageItems.length > 0 && (
                  <div>
                    <p className="font-medium">Falta cargar ocupación manual para {missingStorageItems.length} cliente{missingStorageItems.length !== 1 ? 's' : ''}.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {missingStorageItems.map((item) => (
                        <button
                          key={item.client_id}
                          type="button"
                          onClick={() => navigate(`/clients/${item.client_id}`)}
                          className="rounded-lg border border-yellow-200 bg-white px-3 py-1.5 text-sm font-medium text-yellow-900 hover:bg-yellow-100 transition"
                        >
                          {item.client_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {alerts.due_soon_count > 0 && (
                  <p>{alerts.due_soon_count} remito{alerts.due_soon_count !== 1 ? 's' : ''} vence{alerts.due_soon_count !== 1 ? 'n' : ''} en {alerts.due_soon_days} día{alerts.due_soon_days !== 1 ? 's' : ''}.</p>
                )}
                {alerts.overdue_count > 0 && (
                  <p>{alerts.overdue_count} remito{alerts.overdue_count !== 1 ? 's' : ''} vencido{alerts.overdue_count !== 1 ? 's' : ''} requiere{alerts.overdue_count === 1 ? '' : 'n'} seguimiento.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard label={isClient ? 'Acumulado a abonar' : 'Total estimado'} value={formatCurrency(totals.total)} tone="blue" />
        <SummaryCard label="Storage manual" value={`${formatNumber(totals.totalM3, 3)} m3`} tone="emerald" />
        <SummaryCard label="Pedidos / remitos" value={`${formatNumber(totals.totalOrders, 0)} / ${formatNumber(documents.length, 0)}`} tone="amber" />
        <SummaryCard
          label={isClient ? 'Remitos emitidos' : 'Estado del período'}
          value={isClient ? formatNumber(documents.length, 0) : periodStatus}
          tone={isClient ? 'blue' : canGenerateDocuments ? 'emerald' : 'rose'}
        />
      </section>

      {isAdmin && (
        <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">Configuración</h2>
              <p className="text-sm text-gray-500 mt-1">Administrá tarifas y descuentos sin ocupar espacio en la vista principal.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setShowGlobalRatesModal(true)}
                className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Editar tarifas
              </button>
              <button
                type="button"
                onClick={() => setShowClientRatesModal(true)}
                className="px-4 py-2.5 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition"
              >
                Ajustar descuentos por cliente
              </button>
            </div>
          </div>
          {globalRatesSeenAt && (
            <p className="text-xs text-gray-500 mt-3">
              Última actualización: {new Date(globalRatesSeenAt).toLocaleString('es-AR')}
            </p>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">Cargos manuales</h2>
              <p className="text-sm text-gray-500 mt-1">Ajustes, recargos o servicios no automatizados que impactan en el período actual.</p>
              <p className="text-xs text-gray-500 mt-2">
                {manualChargeTotals.count} cargo{manualChargeTotals.count !== 1 ? 's' : ''} · Total {formatCurrency(manualChargeTotals.total)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowManualChargeModal(true)}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              + Agregar cargo manual
            </button>
          </div>

          {manualCharges.length === 0 ? (
            <div className="px-6 py-5 text-sm text-gray-500">No hay cargos manuales cargados para {period}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Fecha</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Tipo</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Descripción</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Monto</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {manualCharges.map((charge) => (
                    <tr key={charge.id} className="border-b border-gray-200 last:border-b-0">
                      <td className="px-6 py-4 font-medium text-gray-900">{charge.client_name ?? `Cliente #${charge.client_id}`}</td>
                      <td className="px-4 py-4 text-gray-500">{new Date(charge.fecha).toLocaleDateString('es-AR')}</td>
                      <td className="px-4 py-4 text-gray-500">{charge.tipo || 'Sin tipo'}</td>
                      <td className="px-4 py-4 text-gray-900">{charge.descripcion || 'Sin descripción'}</td>
                      <td className={`px-4 py-4 text-right font-medium ${charge.monto >= 0 ? 'text-gray-900' : 'text-red-700'}`}>{formatCurrency(charge.monto)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteManualCharge(charge.id).catch(() => {})}
                          disabled={charge.is_locked || deletingManualChargeId === charge.id}
                          className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition disabled:opacity-50"
                        >
                          {deletingManualChargeId === charge.id ? 'Eliminando...' : charge.is_locked ? 'Período cerrado' : 'Eliminar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Vista previa del período</h2>
          <p className="text-sm text-gray-500 mt-1">Clientes del período con estado y total. Expandí para ver el detalle.</p>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500">Cargando facturación...</div>
        ) : preview.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No hay datos para este período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Pedidos despachados</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Descargas</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Cargos manuales</th>
                  {!isClient && <th className="text-left px-4 py-3 font-medium text-gray-500">Estado</th>}
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Total</th>
                  {isAdmin && <th className="text-right px-6 py-3 font-medium text-gray-500">Acción</th>}
                </tr>
              </thead>
              <tbody>
                {preview.map((item) => {
                  const isExpanded = expandedPreviewClientId === item.client_id;
                  return (
                    <Fragment key={item.client_id}>
                      <tr
                        className={`border-b border-gray-200 cursor-pointer hover:bg-gray-50 ${isExpanded ? 'bg-gray-50' : ''}`}
                        onClick={() => setExpandedPreviewClientId((current) => current === item.client_id ? null : item.client_id)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span className="text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                            <div>
                              <div className="font-medium text-gray-900">{item.client_name}</div>
                              <div className="text-xs text-gray-500 mt-1">Detalle disponible</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right text-gray-500">{formatNumber(toFiniteNumber(item.total_orders), 0)}</td>
                        <td className="px-4 py-4 text-right text-gray-500">{formatCurrency(toFiniteNumber(item.truck_unloading_amount))}</td>
                        <td className={`px-4 py-4 text-right ${toFiniteNumber(item.manual_charge_amount) < 0 ? 'text-red-700' : 'text-gray-500'}`}>{formatCurrency(toFiniteNumber(item.manual_charge_amount))}</td>
                        {!isClient && (
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${item.missing_storage ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-700'}`}>
                              {item.missing_storage ? 'Faltan datos' : 'Listo'}
                            </span>
                          </td>
                        )}
                        <td className="px-6 py-4 text-right font-semibold text-gray-900">{formatCurrency(toFiniteNumber(item.total))}</td>
                        {isAdmin && (
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleGenerateSingleDocument(item.client_id).catch(() => {});
                              }}
                              disabled={item.missing_storage || generatingClientId === item.client_id}
                              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition disabled:opacity-50"
                            >
                              {generatingClientId === item.client_id ? 'Generando...' : 'Generar remito'}
                            </button>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-gray-200 bg-gray-50 last:border-b-0">
                          <td colSpan={isAdmin ? 7 : isClient ? 5 : 6} className="px-6 py-5">
                            <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
                              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                <DetailMetricCard
                                  label="Storage"
                                  value={formatCurrency(toFiniteNumber(item.storage_amount))}
                                  note={`${formatNumber(toFiniteNumber(item.total_m3), 3)} m3 · Base ${formatCurrency(toFiniteNumber(item.storage_base_rate))}`}
                                />
                                <DetailMetricCard
                                  label="Preparación"
                                  value={formatCurrency(toFiniteNumber(item.preparation_amount))}
                                  note={`Primer producto ${formatCurrency(toFiniteNumber(item.preparation_base_rate))} · Adicional ${formatCurrency(toFiniteNumber(item.preparation_rate))}`}
                                />
                                <DetailMetricCard
                                  label="Alta producto"
                                  value={formatCurrency(toFiniteNumber(item.product_creation_amount))}
                                  note={item.product_creation_products.length > 0 ? item.product_creation_products.join(', ') : 'Sin altas en el período'}
                                />
                                <DetailMetricCard
                                  label="Traslados a transporte"
                                  value={formatCurrency(toFiniteNumber(item.transport_dispatch_amount))}
                                  note={item.transport_dispatch_count > 0 ? `Base ${formatCurrency(toFiniteNumber(item.transport_dispatch_amount) / item.transport_dispatch_count)} × ${formatNumber(item.transport_dispatch_count, 0)} viaje${item.transport_dispatch_count !== 1 ? 's' : ''} = ${formatCurrency(toFiniteNumber(item.transport_dispatch_amount))}` : 'Sin traslados en el período'}
                                />
                                <DetailMetricCard
                                  label="Descargas"
                                  value={formatCurrency(toFiniteNumber(item.truck_unloading_amount))}
                                  note={item.truck_unloading_count > 0 ? `Base ${formatCurrency(toFiniteNumber(item.truck_unloading_amount) / item.truck_unloading_count)} × ${formatNumber(item.truck_unloading_count, 0)} camión${item.truck_unloading_count !== 1 ? 'es' : ''} = ${formatCurrency(toFiniteNumber(item.truck_unloading_amount))}` : 'Sin descargas en el período'}
                                />
                                <DetailMetricCard
                                  label="Cargos manuales"
                                  value={formatCurrency(toFiniteNumber(item.manual_charge_amount))}
                                  note={item.manual_charge_items.length > 0 ? `${item.manual_charge_items.length} movimiento${item.manual_charge_items.length !== 1 ? 's' : ''} manual${item.manual_charge_items.length !== 1 ? 'es' : ''}` : 'Sin cargos manuales en el período'}
                                />
                                <DetailMetricCard
                                  label="Envíos"
                                  value={formatCurrency(toFiniteNumber(item.shipping_amount))}
                                  note={`Base ${formatCurrency(toFiniteNumber(item.shipping_base_amount))}`}
                                />
                                <DetailMetricCard
                                  label="Descuentos"
                                  value={`S ${formatNumber(toFiniteNumber(item.storage_discount_pct), 2)}% · E ${formatNumber(toFiniteNumber(item.shipping_discount_pct), 2)}%`}
                                  note="Preparación sin descuento porcentual"
                                />
                              </div>
                              <div className="space-y-4">
                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Total cliente</div>
                                  <div className="text-3xl font-bold text-gray-900 mt-2">{formatCurrency(toFiniteNumber(item.total))}</div>
                                  <div className="mt-3 space-y-2 text-sm text-gray-500">
                                    <p>Pedidos despachados: <span className="font-medium text-gray-900">{formatNumber(toFiniteNumber(item.total_orders), 0)}</span></p>
                                    {!isClient && <p>Estado: <span className={`font-medium ${item.missing_storage ? 'text-yellow-800' : 'text-green-700'}`}>{item.missing_storage ? 'Faltan datos' : 'Listo para facturar'}</span></p>}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Desglose de cargos manuales</div>
                                  {item.manual_charge_items.length === 0 ? (
                                    <div className="text-sm text-gray-500 mt-3">Sin cargos manuales para este cliente en el período.</div>
                                  ) : (
                                    <div className="mt-3 space-y-3">
                                      {item.manual_charge_items.map((charge) => (
                                        <div key={charge.id} className="rounded-xl border border-gray-200 px-3 py-3">
                                          <div className="flex items-start justify-between gap-3">
                                            <div>
                                              <div className="text-sm font-medium text-gray-900">{charge.descripcion || 'Cargo manual'}</div>
                                              <div className="text-xs text-gray-500 mt-1">{new Date(charge.fecha).toLocaleDateString('es-AR')}{charge.tipo ? ` · ${charge.tipo}` : ''}</div>
                                            </div>
                                            <div className={`text-sm font-semibold ${charge.monto < 0 ? 'text-red-700' : 'text-gray-900'}`}>{formatCurrency(toFiniteNumber(charge.monto))}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden mt-2">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Remitos generados</h2>
            <p className="text-sm text-gray-500 mt-1">{isClient ? 'Tus remitos emitidos y el total actualmente acumulado.' : 'Listado por cliente con estado, vencimiento y acción de cobro.'}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
            {isAdmin ? (
              <select
                value={documentClientId}
                onChange={(e) => setDocumentClientId(e.target.value)}
                className="px-4 py-2.5 border border-gray-200 rounded-lg bg-white text-sm"
              >
                <option value="">Todos los clientes</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            ) : (
              <div className="hidden sm:block" />
            )}
            <select
              value={documentStatus}
              onChange={(e) => setDocumentStatus(e.target.value as DocumentStatusFilter)}
              className="px-4 py-2.5 border border-gray-200 rounded-lg bg-white text-sm"
            >
              <option value="all">Todos los estados</option>
              <option value="pending">Pendiente</option>
              <option value="paid">Pagado</option>
              <option value="overdue">Vencido</option>
            </select>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500">
              Total emitido: <span className="font-semibold text-gray-900">{formatCurrency(documentTotals.total)}</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Cargando remitos...</div>
        ) : documents.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No hay remitos para los filtros seleccionados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Período</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Vencimiento</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Estado</th>
                  {isAdmin && <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id} className="border-b border-gray-200 last:border-b-0">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{document.client_name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Storage {formatCurrency(document.storage_total)} · Preparación {formatCurrency(document.preparation_total)} · Alta {formatCurrency(document.product_creation_total)} · Traslados a transporte {formatCurrency(document.transport_dispatch_total)} · Descargas {formatCurrency(document.truck_unloading_total)} · Cargos manuales {formatCurrency(document.manual_charge_total)} · Envío {formatCurrency(document.shipping_total)}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-500">{document.period}</td>
                    <td className="px-4 py-4 text-right font-semibold text-gray-900">{formatCurrency(document.total)}</td>
                    <td className="px-4 py-4 text-gray-500">{new Date(document.due_date).toLocaleDateString('es-AR')}</td>
                    <td className="px-4 py-4">
                      <DocumentStatusBadge status={document.status} />
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          {document.status !== 'paid' && (
                            <button
                              onClick={() => handleMarkPaid(document.id).catch(() => {})}
                              disabled={markingPaidId === document.id}
                              className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition disabled:opacity-50"
                            >
                              {markingPaidId === document.id ? 'Procesando...' : 'Marcar como pagado'}
                            </button>
                          )}
                          <button
                            onClick={() => navigate('/billing/history')}
                            className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                          >
                            Ver cobros
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isAdmin && showGlobalRatesModal && (
        <GlobalRatesModal
          form={globalRatesForm}
          saving={savingGlobalRates}
          onClose={() => setShowGlobalRatesModal(false)}
          onChange={(field, value) => setGlobalRatesForm((current) => ({ ...current, [field]: value }))}
          onSubmit={handleSaveGlobalRates}
        />
      )}

      {isAdmin && showClientRatesModal && (
        <ClientRatesModal
          clientRates={clientRates}
          clientRateForms={clientRateForms}
          savingClientId={savingClientId}
          onClose={() => setShowClientRatesModal(false)}
          onChangeForm={(clientId, field, value) => setClientRateForms((current) => ({
            ...current,
            [clientId]: {
              ...current[clientId],
              client_id: clientId,
              [field]: value,
            },
          }))}
          onSave={handleSaveClientRate}
        />
      )}

      {isAdmin && showManualChargeModal && (
        <ManualChargeModal
          clients={clients}
          form={manualChargeForm}
          saving={savingManualCharge}
          onClose={() => setShowManualChargeModal(false)}
          onChange={(field, value) => setManualChargeForm((current) => ({ ...current, [field]: value }))}
          onSubmit={handleCreateManualCharge}
        />
      )}
    </div>
  );
}

function DocumentStatusBadge({ status }: { status: BillingDocument['status'] }) {
  const label = status === 'paid' ? '🟢 Pagado' : status === 'overdue' ? '🔴 Vencido' : '🟡 Pendiente';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getChargeStatusClasses(status)}`}>
      {label}
    </span>
  );
}

function GlobalRatesModal({
  form,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  form: {
    storage_per_m3: string;
    preparation_base_fee: string;
    preparation_additional_fee: string;
    product_creation_fee: string;
    transport_dispatch_fee: string;
    truck_unloading_fee: string;
    shipping_base: string;
  };
  saving: boolean;
  onClose: () => void;
  onChange: (field: 'storage_per_m3' | 'preparation_base_fee' | 'preparation_additional_fee' | 'product_creation_fee' | 'transport_dispatch_fee' | 'truck_unloading_fee' | 'shipping_base', value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[520px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Editar tarifas globales</h2>
            <p className="text-sm text-gray-500 mt-1">Definí los valores por defecto para almacenamiento, preparación y envío.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <form onSubmit={(event) => { onSubmit(event).catch(() => {}); }} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
            <div className="space-y-4">
              <RateField
                label="Almacenamiento por m3"
                value={form.storage_per_m3}
                onChange={(value) => onChange('storage_per_m3', value)}
              />
              <RateField
                label="Precio preparación base"
                value={form.preparation_base_fee}
                onChange={(value) => onChange('preparation_base_fee', value)}
              />
              <RateField
                label="Precio preparación adicional"
                value={form.preparation_additional_fee}
                onChange={(value) => onChange('preparation_additional_fee', value)}
              />
              <RateField
                label="Costo alta de producto"
                value={form.product_creation_fee}
                onChange={(value) => onChange('product_creation_fee', value)}
              />
              <RateField
                label="Precio por traslado a transporte"
                value={form.transport_dispatch_fee}
                onChange={(value) => onChange('transport_dispatch_fee', value)}
              />
              <RateField
                label="Precio descarga por camión"
                value={form.truck_unloading_fee}
                onChange={(value) => onChange('truck_unloading_fee', value)}
              />
              <RateField
                label="Base de envío"
                value={form.shipping_base}
                onChange={(value) => onChange('shipping_base', value)}
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-gray-200 px-6 py-4 bg-white">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
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
                className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar tarifas'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ClientRatesModal({
  clientRates,
  clientRateForms,
  savingClientId,
  onClose,
  onChangeForm,
  onSave,
}: {
  clientRates: ClientRate[];
  clientRateForms: Record<number, EditableClientRate>;
  savingClientId: number | null;
  onClose: () => void;
  onChangeForm: (
    clientId: number,
    field: 'storage_discount_pct' | 'shipping_discount_pct',
    value: string,
  ) => void;
  onSave: (clientId: number) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[800px] overflow-hidden max-h-[calc(100vh-2rem)]">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Ajustar descuentos por cliente</h2>
            <p className="text-sm text-gray-500 mt-1">Dejá el campo vacío para no aplicar descuento. Valores entre 0 y 100.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Almacenamiento (%)</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Envío (%)</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acción</th>
              </tr>
            </thead>
            <tbody>
              {clientRates.map((item) => {
                const form = clientRateForms[item.client_id];
                return (
                  <tr key={item.client_id} className="border-b border-gray-200 last:border-b-0">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{item.client_name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Efectivas: {formatCurrency(item.effective_storage_per_m3)} / {formatCurrency(item.effective_shipping_base)}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={form?.storage_discount_pct ?? ''}
                        onChange={(e) => onChangeForm(item.client_id, 'storage_discount_pct', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                        placeholder="Sin descuento"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={form?.shipping_discount_pct ?? ''}
                        onChange={(e) => onChangeForm(item.client_id, 'shipping_discount_pct', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                        placeholder="Sin descuento"
                      />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => onSave(item.client_id).catch(() => {})}
                        disabled={savingClientId === item.client_id}
                        className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg font-medium hover:bg-blue-50 transition disabled:opacity-50"
                      >
                        {savingClientId === item.client_id ? 'Guardando...' : 'Guardar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualChargeModal({
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
    monto: string;
    tipo: string;
    descripcion: string;
    fecha: string;
  };
  saving: boolean;
  onClose: () => void;
  onChange: (field: 'client_id' | 'monto' | 'tipo' | 'descripcion' | 'fecha', value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-[560px] overflow-y-auto max-h-[calc(100vh-2rem)]">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Agregar cargo manual</h2>
            <p className="text-sm text-gray-500 mt-1">Registrá ajustes manuales para el período actual. El monto puede ser positivo o negativo, pero no cero.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <form onSubmit={(event) => { onSubmit(event).catch(() => {}); }} className="px-6 py-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Cliente</label>
            <select
              value={form.client_id}
              onChange={(e) => onChange('client_id', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white"
              required
            >
              <option value="">Seleccionar cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Monto</label>
              <input
                type="number"
                step="0.01"
                value={form.monto}
                onChange={(e) => onChange('monto', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
                placeholder="Ej. 2500 o -1200"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Fecha</label>
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => onChange('fecha', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Tipo</label>
            <input
              type="text"
              value={form.tipo}
              onChange={(e) => onChange('tipo', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
              placeholder="Ej. ajuste, recargo, servicio extra"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Descripción</label>
            <textarea
              value={form.descripcion}
              onChange={(e) => onChange('descripcion', e.target.value)}
              rows={4}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg resize-none"
              placeholder="Detalle visible en el período y en el historial"
            />
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-2">
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
              className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar cargo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'emerald' | 'amber' | 'rose' }) {
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    emerald: 'border-green-200 bg-green-50 text-green-700',
    amber: 'border-yellow-200 bg-yellow-50 text-yellow-800',
    rose: 'border-red-200 bg-red-50 text-red-700',
  } as const;

  return (
    <div className={`rounded-2xl border p-5 ${toneClasses[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</div>
      <div className="text-3xl font-bold mt-3 leading-tight">{value}</div>
    </div>
  );
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
    fallback
  );
}

function DetailMetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900 mt-2">{value}</div>
      <div className="text-xs text-gray-500 mt-2">{note}</div>
    </div>
  );
}

function RateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg"
      />
    </div>
  );
}