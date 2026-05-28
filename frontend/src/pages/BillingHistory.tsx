import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BillingChargeDetailModal from '../components/BillingChargeDetailModal';
import { fetchClients, type Client } from '../services/clients';
import { fetchChargeDetail, fetchCharges, type Charge } from '../services/billing';
import { downloadChargesPdf } from '../utils/billingPdf';
import { formatCurrency, getChargeStatusClasses, getChargeStatusLabel } from '../utils/billingFormat';

const PAGE_SIZE = 10;

export default function BillingHistory() {
  const [clients, setClients] = useState<Client[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadCharges = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchCharges({
        client_id: clientId ? Number(clientId) : undefined,
        due_date_from: dateFrom || undefined,
        due_date_to: dateTo || undefined,
        status: status === 'all' ? undefined : status,
      });
      setCharges(data);
      setCurrentPage(1);
    } catch {
      setError('No se pudo cargar el historial de cobros.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients().then(setClients).catch(() => {});
    loadCharges().catch(() => {});
  }, []);

  const filteredCharges = charges;
  const totalPages = Math.max(1, Math.ceil(filteredCharges.length / PAGE_SIZE));
  const paginatedCharges = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredCharges.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredCharges]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleOpenDetail = async (chargeId: number) => {
    setDetailLoading(true);
    setSelectedCharge(null);
    try {
      const detail = await fetchChargeDetail(chargeId);
      setSelectedCharge(detail);
    } catch {
      setError('No se pudo cargar el detalle del cobro.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDownloadFiltered = () => {
    try {
      downloadChargesPdf(filteredCharges, 'Historial de cobros filtrado');
    } catch {
      setError('No hay cobros filtrados para exportar.');
    }
  };

  const handleDownloadSingle = (charge: Charge) => {
    downloadChargesPdf([charge], `Cobro ${charge.client_name ?? `#${charge.client_id}`} ${charge.period}`, `cobro-${charge.id}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-sm text-gray-500 mb-2"><Link to="/billing" className="hover:text-gray-900">Facturación</Link> / Historial</div>
          <h1 className="text-2xl font-bold text-gray-900">Historial de cobros</h1>
          <p className="text-sm text-gray-500 mt-1">Explorá los cobros emitidos, filtrá por rango y exportá la vista actual.</p>
        </div>
        <button
          onClick={handleDownloadFiltered}
          className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium"
        >
          Descargar PDF
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Cliente</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white">
              <option value="">Todos los clientes</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Fecha desde</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white" />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Fecha hasta</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white" />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Estado</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'pending' | 'paid')} className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white">
              <option value="all">Todos</option>
              <option value="pending">Pendiente</option>
              <option value="paid">Cobrado</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button onClick={() => loadCharges().catch(() => {})} className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium">Filtrar</button>
            <button
              onClick={() => {
                setClientId('');
                setDateFrom('');
                setDateTo('');
                setStatus('all');
                window.setTimeout(() => { loadCharges().catch(() => {}); }, 0);
              }}
              className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Limpiar
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Resultados</h2>
            <p className="text-sm text-gray-500 mt-1">{filteredCharges.length} cobro{filteredCharges.length !== 1 ? 's' : ''} encontrado{filteredCharges.length !== 1 ? 's' : ''}.</p>
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Cargando historial...</div>
        ) : filteredCharges.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No hay cobros para los filtros seleccionados.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Período</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Vencimiento</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Estado</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Total</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedCharges.map((charge) => (
                    <tr key={charge.id} className="border-b border-gray-200 last:border-b-0">
                      <td className="px-6 py-4 font-medium text-gray-900">{charge.client_name ?? `Cliente #${charge.client_id}`}</td>
                      <td className="px-4 py-4 text-gray-500">{charge.period}</td>
                      <td className="px-4 py-4 text-gray-500">{new Date(charge.due_date).toLocaleDateString('es-AR')}</td>
                      <td className="px-4 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getChargeStatusClasses(charge.status)}`}>
                          {getChargeStatusLabel(charge.status)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right font-semibold text-gray-900">{formatCurrency(charge.total)}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => handleOpenDetail(charge.id).catch(() => {})} className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-50 transition">Ver detalle</button>
                          <button onClick={() => handleDownloadSingle(charge)} className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition">Descargar PDF</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <p className="text-sm text-gray-500">Página {currentPage} de {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {(detailLoading || selectedCharge) && (
        <BillingChargeDetailModal charge={selectedCharge} loading={detailLoading} onClose={() => setSelectedCharge(null)} />
      )}
    </div>
  );
}