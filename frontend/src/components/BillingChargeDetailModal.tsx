import type { Charge } from '../services/billing';
import { formatCurrency, formatNumber, getChargeStatusLabel } from '../utils/billingFormat';

export default function BillingChargeDetailModal({
  charge,
  loading,
  onClose,
}: {
  charge: Charge | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Detalle del cobro</h2>
            <p className="text-sm text-gray-500 mt-1">
              {charge ? `${charge.client_name ?? `Cliente #${charge.client_id}`} · ${charge.period}` : 'Cargando...'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        {loading || !charge ? (
          <div className="py-10 text-center text-gray-500">Cargando detalle...</div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <BreakdownCard
                label="Almacenamiento"
                value={formatCurrency(charge.storage_amount)}
                note={`Base ${formatCurrency(charge.base_storage_rate)} · Desc ${formatNumber(charge.storage_discount_pct, 2)}% · Final ${formatCurrency(charge.applied_storage_rate)} · ${formatNumber(charge.total_m3, 3)} m3`}
              />
              <BreakdownCard
                label="Preparación"
                value={formatCurrency(charge.preparation_amount)}
                note={`Primer producto ${formatCurrency(charge.base_preparation_rate)} · Adicional ${formatCurrency(charge.applied_preparation_rate)} · ${formatNumber(charge.total_orders, 0)} pedidos`}
              />
              <BreakdownCard
                label="Alta producto"
                value={formatCurrency(charge.product_creation_amount)}
                note={charge.product_creation_amount > 0 ? 'Costo aplicado por creación inicial de productos en el período.' : 'Sin altas cobradas en este período.'}
              />
              <BreakdownCard
                label="Traslados a transporte"
                value={formatCurrency(charge.transport_dispatch_amount)}
                note={charge.transport_dispatch_amount > 0 ? 'Costo por viajes del depósito hacia transportes registrados en el período.' : 'Sin traslados cobrados en este período.'}
              />
              <BreakdownCard
                label="Descargas"
                value={formatCurrency(charge.truck_unloading_amount)}
                note={charge.truck_unloading_amount > 0 ? 'Costo por descargas de camión registradas en el período.' : 'Sin descargas cobradas en este período.'}
              />
              <BreakdownCard
                label="Cargos manuales"
                value={formatCurrency(charge.manual_charge_amount)}
                note={charge.manual_charge_amount !== 0 ? 'Ajustes manuales agregados para este cliente antes del cierre del período.' : 'Sin cargos manuales en este período.'}
              />
              <BreakdownCard
                label="Envíos"
                value={formatCurrency(charge.shipping_amount)}
                note={`Base ${formatCurrency(charge.shipping_base_amount)} · Desc ${formatNumber(charge.shipping_discount_pct, 2)}%`}
              />
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>Total del período</span>
                <span className="text-xl font-bold text-gray-900">{formatCurrency(charge.total)}</span>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-500">
                <div>Vencimiento: <span className="font-medium text-gray-900">{new Date(charge.due_date).toLocaleDateString('es-AR')}</span></div>
                <div>Estado: <span className="font-medium text-gray-900">{getChargeStatusLabel(charge.status)}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BreakdownCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-2">{value}</div>
      <div className="text-xs text-gray-500 mt-2">{note}</div>
    </div>
  );
}