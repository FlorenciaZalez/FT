import { useState, useEffect, useCallback } from 'react';
import {
  fetchAlerts,
  runAlertChecks,
} from '../services/alerts';
import type { Alert } from '../services/alerts';

const TYPE_LABELS: Record<string, string> = {
  low_stock: 'Stock bajo',
  no_stock: 'Sin stock',
  pending_timeout: 'Pedido retrasado',
  prepared_not_dispatched: 'Preparado sin despachar',
  picking_error: 'Error de picking',
};

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  no_stock:                { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-600' },
  low_stock:               { bg: 'bg-yellow-50', text: 'text-yellow-800', dot: 'bg-amber-500' },
  pending_timeout:         { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-600' },
  prepared_not_dispatched: { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-600' },
  picking_error:           { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-600' },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-50 text-red-700',
  warning:  'bg-yellow-50 text-yellow-800',
  info:     'bg-gray-50 text-gray-500',
};

const FILTER_OPTIONS = [
  { value: '',                       label: 'Todos los tipos' },
  { value: 'no_stock',               label: 'Sin stock' },
  { value: 'low_stock',              label: 'Stock bajo' },
  { value: 'pending_timeout',        label: 'Pedido retrasado' },
  { value: 'prepared_not_dispatched', label: 'Preparado sin despachar' },
  { value: 'picking_error',          label: 'Error de escaneo' },
];

const SEVERITY_OPTIONS = [
  { value: '',         label: 'Todas las prioridades' },
  { value: 'critical', label: 'Crítica' },
  { value: 'warning',  label: 'Importante' },
  { value: 'info',     label: 'Informativa' },
];

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | boolean> = { active_only: true };
      if (filterType) params.alert_type = filterType;
      if (filterSeverity) params.severity = filterSeverity;
      const data = await fetchAlerts(
        Object.keys(params).length > 0
          ? (params as { active_only?: boolean; alert_type?: string; severity?: string })
          : undefined,
      );
      setAlerts(data);
    } catch (err) {
      console.error('Error loading alerts', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterSeverity]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRunChecks = async () => {
    setChecking(true);
    try {
      await runAlertChecks();
      await load();
    } catch (err) {
      console.error('Error running checks', err);
    } finally {
      setChecking(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const activeCount = alerts.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alertas</h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeCount} alerta{activeCount !== 1 ? 's' : ''} activa{activeCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRunChecks}
            disabled={checking}
            className="ui-btn-primary px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {checking ? 'Verificando...' : 'Verificar alertas'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

      </div>

      {/* Alert list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando alertas...</div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Sin alertas</p>
          <p className="text-border text-sm mt-1">
            No hay alertas activas con los filtros seleccionados
          </p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
          {alerts.map((alert) => {
            const colors = TYPE_COLORS[alert.alert_type] || TYPE_COLORS.picking_error;

            return (
              <div
                key={alert.id}
                className={`rounded-xl border border-gray-200 p-4 flex items-start gap-4 ${colors.bg}`}
              >
                <div className="pt-1">
                  <div className={`w-3 h-3 rounded-full ${colors.dot}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors.text} ${colors.bg}`}
                    >
                      {TYPE_LABELS[alert.alert_type] || alert.alert_type}
                    </span>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        SEVERITY_BADGE[alert.severity] || SEVERITY_BADGE.info
                      }`}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-900">{alert.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatDate(alert.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
