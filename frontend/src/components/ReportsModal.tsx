import { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { downloadOrdersReportCsv, fetchOrdersReport, type OrderReportRow } from '../services/reportsService';

type ReportsModalProps = {
  onClose: () => void;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsModal({ onClose }: ReportsModalProps) {
  const [fromDate, setFromDate] = useState(todayDateInput());
  const [toDate, setToDate] = useState(todayDateInput());
  const [rows, setRows] = useState<OrderReportRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const validationError = useMemo(() => {
    if (!fromDate || !toDate) return 'Debés seleccionar ambas fechas.';
    if (fromDate > toDate) return 'La fecha Desde no puede ser mayor que Hasta.';
    return '';
  }, [fromDate, toDate]);

  const runPreview = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoadingPreview(true);
    setError('');
    try {
      const data = await fetchOrdersReport({ fromDate, toDate });
      setRows(data);
      setLoaded(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? 'No se pudo cargar el reporte';
      setRows([]);
      setLoaded(true);
      setError(msg);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleDownload = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setDownloading(true);
    setError('');
    try {
      await downloadOrdersReportCsv({ fromDate, toDate });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? 'No se pudo descargar el CSV';
      setError(msg);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Exportar reportes</h2>
            <p className="text-sm text-gray-500 mt-1">Consultá pedidos por rango de fechas y descargá el reporte en CSV.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">&times;</button>
        </div>

        <div className="px-6 py-5 border-b border-gray-200 bg-gray-50">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Desde</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Hasta</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => { void runPreview(); }}
              disabled={loadingPreview || downloading}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-900 hover:bg-white disabled:opacity-50"
            >
              {loadingPreview ? 'Cargando...' : 'Ver reporte'}
            </button>
            <button
              type="button"
              onClick={() => { void handleDownload(); }}
              disabled={loadingPreview || downloading}
              className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {downloading ? 'Descargando...' : 'Descargar CSV'}
            </button>
          </div>
          {(error || validationError) && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error || validationError}
            </div>
          )}
        </div>

        <div className="px-6 py-5 flex-1 overflow-hidden bg-white">
          {loadingPreview ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500 gap-2">
              <Loader2 size={16} className="animate-spin" /> Cargando reporte...
            </div>
          ) : loaded && rows.length === 0 && !error ? (
            <div className="h-full flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
              No hay pedidos para el rango seleccionado.
            </div>
          ) : rows.length > 0 ? (
            <div className="h-full overflow-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Pedido</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Fecha</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Cliente</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Dirección</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">CP</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Ciudad</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Provincia</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Cordón</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Estado</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Carrier</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.order_id}-${row.created_at}`} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-4 py-3 text-gray-900 font-medium">#{row.order_id}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                      <td className="px-4 py-3 text-gray-600 min-w-[14rem]">{row.product_name}</td>
                      <td className="px-4 py-3 text-gray-600">{row.customer_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 min-w-[16rem]">{row.shipping_address ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{row.zip_code ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{row.city ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{row.province ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.cordon}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.status}</td>
                      <td className="px-4 py-3 text-gray-600">{row.carrier ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
              Elegí un rango de fechas para ver el reporte.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}