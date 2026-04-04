import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBatches, type DispatchBatch } from '../services/batches';

export default function Batches() {
  const [batches, setBatches] = useState<DispatchBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [carrierFilter, setCarrierFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(value), 300);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  useEffect(() => {
    fetchBatches()
      .then(setBatches)
      .catch(() => setError('Error al cargar lotes'))
      .finally(() => setLoading(false));
  }, []);

  // Unique transporters for dropdown (prefer transporter_name, fallback to carrier)
  const transporterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of batches) {
      const name = b.transporter_name || b.carrier;
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [batches]);

  // Filtered batches
  const filteredBatches = useMemo(() => {
    let result = batches;

    // Text search
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((b) => b.batch_number.toLowerCase().includes(q));
    }

    // Transporter / carrier filter
    if (carrierFilter) {
      result = result.filter((b) => (b.transporter_name || b.carrier) === carrierFilter);
    }

    // Date range
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      result = result.filter((b) => new Date(b.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((b) => new Date(b.created_at) <= to);
    }

    return result;
  }, [batches, searchQuery, carrierFilter, dateFrom, dateTo]);

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Lotes de despacho</h1>
        <p className="text-gray-500 text-sm mt-0.5">Historial de despachos agrupados por lote</p>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar lote..."
            className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setSearchQuery(''); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-500 text-sm"
            >✕</button>
          )}
        </div>

        {/* Carrier filter */}
        <select
          value={carrierFilter}
          onChange={(e) => setCarrierFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[170px]"
        >
          <option value="">Todos los transportistas</option>
          {transporterOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <span className="text-gray-500 text-xs">a</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-gray-500 hover:text-gray-500 text-sm ml-0.5"
            >✕</button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando lotes...</div>
      ) : batches.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">No hay lotes de despacho</p>
          <p className="text-gray-500 text-sm">Los lotes se crean automáticamente al despachar pedidos.</p>
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">Sin resultados</p>
          <p className="text-gray-500 text-sm">Probá con otra búsqueda o ajustá los filtros.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0 table-scroll-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Lote</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Fecha</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Transportista</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Pedidos</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Observaciones</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.map((b) => (
                <tr key={b.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-medium text-gray-900 bg-gray-50 px-2 py-0.5 rounded">
                      {b.batch_number}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-xs">
                    {new Date(b.created_at).toLocaleDateString('es-AR', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-6 py-4">
                    {(b.transporter_name || b.carrier) ? (
                      <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">
                        🚚 {b.transporter_name || b.carrier}
                      </span>
                    ) : (
                      <span className="text-gray-500 text-xs">Sin definir</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">
                      {b.order_count} pedido{b.order_count !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-xs max-w-[200px] truncate">
                    {b.notes || '—'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => navigate(`/batches/${b.id}`)}
                      className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
