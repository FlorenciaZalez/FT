import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { scanSkuForDispatch, batchDispatch, fetchOrderByShipping, dispatchOrder, type Order } from '../services/orders';
import { fetchTransporters, type Transporter } from '../services/transporters';

type SessionPhase = 'setup' | 'scanning' | 'done';

interface ScannedEntry {
  order: Order;
  sku: string;
  scannedAt: Date;
}

interface ConflictState {
  sku: string;
  candidates: Order[];
}

type ScanDetectionType = 'sku' | 'qr';

interface QrLookupState {
  rawCode: string;
  shippingId: string | null;
  order: Order | null;
  loading: boolean;
  error: string | null;
}

function detectScanType(value: string): ScanDetectionType {
  return value.toLowerCase().includes('shipments/') ? 'qr' : 'sku';
}

function extractShippingId(value: string): string | null {
  const match = value.match(/shipments\/(\d+)/i);
  return match?.[1] ?? null;
}

function formatOrderStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    in_preparation: 'En preparación',
    prepared: 'Listo para despacho',
    dispatched: 'Despachado',
    awaiting_return: 'Esperando devolución',
    returned_pending_review: 'Devolución pendiente de revisión',
    returned_completed: 'Devolución completada',
    cancelled: 'Cancelado',
  };
  return labels[status] ?? status;
}

function buildOrderAddress(order: Order): string {
  const parts = [order.address_line || order.buyer_address, order.city, order.state, order.postal_code]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim());
  return parts.join(' · ');
}

export default function DispatchSession() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<SessionPhase>('setup');
  const quickNotes = ['Faltante', 'Dañado', 'Parcial'] as const;
  const [transportTransferMode, setTransportTransferMode] = useState(false);

  // Setup
  const [selectedTransporterId, setSelectedTransporterId] = useState<number | null>(null);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [transporterSearch, setTransporterSearch] = useState('');
  const [showTransporterDropdown, setShowTransporterDropdown] = useState(false);

  // Scanning
  const [skuInput, setSkuInput] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [entries, setEntries] = useState<ScannedEntry[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [lastDetectedType, setLastDetectedType] = useState<ScanDetectionType | null>(null);
  const [qrLookup, setQrLookup] = useState<QrLookupState | null>(null);
  const [qrDispatchLoading, setQrDispatchLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Conflict resolution
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  // Confirm
  const [showConfirm, setShowConfirm] = useState(false);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');

  // Result
  const [result, setResult] = useState<{ batchId: number; batchNumber: string; count: number; carrier: string | null } | null>(null);

  const selectedTransporter = useMemo(
    () => transporters.find((t) => t.id === selectedTransporterId) ?? null,
    [transporters, selectedTransporterId],
  );

  const filteredTransporters = useMemo(() => {
    const q = transporterSearch.trim().toLowerCase();
    const active = transporters.filter((t) => t.active);
    if (!q) return active;
    return active.filter((t) => t.name.toLowerCase().includes(q));
  }, [transporters, transporterSearch]);

  useEffect(() => {
    fetchTransporters(true).then(setTransporters).catch(() => {});
  }, []);

  useEffect(() => {
    if (!transportTransferMode) return;
    setSelectedTransporterId(null);
    setTransporterSearch('');
    setShowTransporterDropdown(false);
  }, [transportTransferMode]);

  const scannedOrderIds = useMemo(() => new Set(entries.map((e) => e.order.id)), [entries]);
  const uniqueOrders = entries.filter((e, i, arr) => arr.findIndex((x) => x.order.id === e.order.id) === i);
  const transferSummary = useMemo(() => {
    const grouped = new Map<number, { clientId: number; clientName: string; productCount: number; orderCount: number }>();
    uniqueOrders.forEach((entry) => {
      const current = grouped.get(entry.order.client_id) ?? {
        clientId: entry.order.client_id,
        clientName: entry.order.client_name ?? `Cliente #${entry.order.client_id}`,
        productCount: 0,
        orderCount: 0,
      };
      current.productCount += entry.order.items.reduce((sum, item) => sum + item.quantity, 0);
      current.orderCount += 1;
      grouped.set(entry.order.client_id, current);
    });
    return Array.from(grouped.values()).sort((left, right) => left.clientName.localeCompare(right.clientName));
  }, [uniqueOrders]);

  const startSession = () => {
    setPhase('scanning');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const addOrder = useCallback((order: Order, sku: string) => {
    setEntries((prev) => [{ order, sku, scannedAt: new Date() }, ...prev]);
    setFeedback({
      type: 'success',
      message: `SKU detectado · ${sku} → ${order.order_number} (${order.client_name ?? 'Sin cliente'})`,
    });
  }, []);

  const handleQrLookup = useCallback(async (rawCode: string) => {
    const shippingId = extractShippingId(rawCode);

    if (!shippingId) {
      setQrLookup({
        rawCode,
        shippingId: null,
        order: null,
        loading: false,
        error: 'QR inválido. No se pudo extraer el shipping_id.',
      });
      setFeedback({ type: 'error', message: 'QR detectado, pero el formato no es válido.' });
      return;
    }

    setQrLookup({ rawCode, shippingId, order: null, loading: true, error: null });

    try {
      const order = await fetchOrderByShipping(shippingId);
      setQrLookup({ rawCode, shippingId, order, loading: false, error: null });
      setFeedback({ type: 'success', message: `QR detectado · envío ${shippingId} → ${order.order_number}` });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se encontró un pedido para ese shipping_id';
      setQrLookup({ rawCode, shippingId, order: null, loading: false, error: msg });
      setFeedback({ type: 'error', message: `QR detectado · ${msg}` });
    }
  }, []);

  const handleScan = useCallback(async () => {
    const rawCode = skuInput.trim();
    if (!rawCode) return;

    const detectedType = detectScanType(rawCode);

    setScanLoading(true);
    setFeedback(null);
    setLastDetectedType(detectedType);

    if (detectedType === 'qr') {
      try {
        await handleQrLookup(rawCode);
      } finally {
        setSkuInput('');
        setScanLoading(false);
        inputRef.current?.focus();
      }
      return;
    }

    try {
      const sku = rawCode;
      const orders = await scanSkuForDispatch(sku);

      if (orders.length === 0) {
        setFeedback({ type: 'error', message: `SKU detectado · no se encontraron pedidos preparados con SKU "${sku}"` });
        setSkuInput('');
        setScanLoading(false);
        inputRef.current?.focus();
        return;
      }

      // Filter out already-scanned orders
      const newOrders = orders.filter((o) => !scannedOrderIds.has(o.id));

      if (newOrders.length === 0) {
        setFeedback({ type: 'warning', message: `SKU detectado · los pedidos con SKU "${sku}" ya fueron escaneados` });
      } else if (newOrders.length === 1) {
        // CASO 1: Single order → auto-assign
        addOrder(newOrders[0], sku);
      } else {
        // CASO 2: Multiple orders → show conflict modal
        setConflict({ sku, candidates: newOrders });
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al buscar';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setSkuInput('');
      setScanLoading(false);
      if (!conflict) inputRef.current?.focus();
    }
  }, [skuInput, scannedOrderIds, addOrder, conflict, handleQrLookup]);

  const handleConfirmQrDispatch = useCallback(async () => {
    if (!qrLookup?.order) return;

    if (qrLookup.order.status === 'dispatched') {
      setFeedback({ type: 'warning', message: 'Este pedido ya fue despachado. No se puede despachar dos veces.' });
      return;
    }

    if (qrLookup.order.status !== 'prepared') {
      setFeedback({
        type: 'warning',
        message: `El pedido está en estado "${formatOrderStatus(qrLookup.order.status)}" y no puede despacharse desde este flujo.`,
      });
      return;
    }

    setQrDispatchLoading(true);
    setFeedback(null);

    try {
      const updatedOrder = await dispatchOrder(qrLookup.order.id, qrLookup.shippingId ?? undefined);
      setQrLookup((prev) => prev ? { ...prev, order: updatedOrder } : prev);
      setFeedback({ type: 'success', message: `Despacho confirmado · ${updatedOrder.order_number} quedó marcado como despachado.` });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'No se pudo confirmar el despacho';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setQrDispatchLoading(false);
      inputRef.current?.focus();
    }
  }, [qrLookup]);

  const handlePickConflict = (order: Order) => {
    if (!conflict) return;
    addOrder(order, conflict.sku);
    setConflict(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleCloseConflict = () => {
    setConflict(null);
    setFeedback({ type: 'error', message: 'Escaneo cancelado — no se seleccionó pedido' });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const removeEntry = (orderId: number) => {
    setEntries((prev) => prev.filter((e) => e.order.id !== orderId));
  };

  const applyQuickNote = (note: string) => {
    setDispatchNotes((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return note;
      if (trimmed.toLowerCase().includes(note.toLowerCase())) return prev;
      return `${prev.trimEnd()}\n${note}`;
    });
  };

  const handleConfirmDispatch = async () => {
    setDispatchLoading(true);
    setDispatchError('');
    try {
      const res = await batchDispatch({
        order_ids: uniqueOrders.map((e) => e.order.id),
        carrier: transportTransferMode ? undefined : selectedTransporter?.name || undefined,
        transporter_id: transportTransferMode ? undefined : selectedTransporterId ?? undefined,
        notes: dispatchNotes.trim() || undefined,
        register_transport_transfer: transportTransferMode,
      });
      setResult({ batchId: res.batch_id, batchNumber: res.batch_number, count: res.order_count, carrier: res.carrier });
      setShowConfirm(false);
      setPhase('done');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al despachar';
      setDispatchError(msg);
    } finally {
      setDispatchLoading(false);
    }
  };

  const resetSession = () => {
    setPhase('setup');
    setSelectedTransporterId(null);
    setTransporterSearch('');
    setSkuInput('');
    setEntries([]);
    setFeedback(null);
    setLastDetectedType(null);
    setQrLookup(null);
    setQrDispatchLoading(false);
    setResult(null);
    setShowConfirm(false);
    setDispatchError('');
    setDispatchNotes('');
    setTransportTransferMode(false);
  };

  // ─── Phase: SETUP ───
  if (phase === 'setup') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Nuevo despacho</h1>
          <p className="text-gray-500 text-sm mt-1">Configurá la sesión de despacho y empezá a escanear</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Modo</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTransportTransferMode(false)}
                className={`rounded-xl border px-4 py-3 text-left transition ${!transportTransferMode ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
              >
                <div className="text-sm font-semibold text-gray-900">Despacho normal</div>
                <div className="text-xs text-gray-500 mt-1">No registra traslados automáticos.</div>
              </button>
              <button
                type="button"
                onClick={() => setTransportTransferMode(true)}
                className={`rounded-xl border px-4 py-3 text-left transition ${transportTransferMode ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
              >
                <div className="text-sm font-semibold text-gray-900">Llevar a transporte</div>
                <div className="text-xs text-gray-500 mt-1">Agrupa por cliente y registra 1 traslado automático por cliente.</div>
              </button>
            </div>
          </div>

          {transportTransferMode ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <div className="text-sm font-medium text-blue-900">Traslado realizado por el depósito</div>
              <div className="text-xs text-blue-700 mt-1">En este modo no hace falta elegir transportista porque el depósito realiza el traslado.</div>
            </div>
          ) : (
            <div className="relative">
              <label className="block text-sm font-medium text-gray-900 mb-1">
                Transportista <span className="text-gray-500 font-normal">(opcional)</span>
              </label>
              {selectedTransporter ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-green-200 bg-green-50 rounded-lg">
                  <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">🚚 {selectedTransporter.name}</span>
                  {selectedTransporter.zone && (
                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">{selectedTransporter.zone}</span>
                  )}
                  <button
                    onClick={() => { setSelectedTransporterId(null); setTransporterSearch(''); }}
                    className="ml-auto text-gray-500 hover:text-red-700 text-sm"
                  >✕</button>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={transporterSearch}
                    onChange={(e) => { setTransporterSearch(e.target.value); setShowTransporterDropdown(true); }}
                    onFocus={() => setShowTransporterDropdown(true)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="Buscar transportista..."
                    autoComplete="off"
                  />
                  {showTransporterDropdown && filteredTransporters.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredTransporters.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSelectedTransporterId(t.id);
                            setTransporterSearch('');
                            setShowTransporterDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center gap-2"
                        >
                          <span className="font-medium text-gray-900">{t.name}</span>
                          {t.zone && <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{t.zone}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {showTransporterDropdown && transporterSearch && filteredTransporters.length === 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm text-gray-500 text-center">
                      No se encontraron transportistas activos
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={startSession}
            className="w-full bg-green-600 text-white py-3 rounded-lg text-sm font-bold hover:opacity-90 transition"
          >
            {transportTransferMode ? '🚚 Iniciar sesión para llevar a transporte' : '🚚 Iniciar sesión de despacho'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase: DONE ───
  if (phase === 'done' && result) {
    const verifyUrl = `${window.location.origin}/dispatch/verify/${result.batchNumber}`;
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Despacho completado</h1>
        <p className="text-gray-500 mb-2">
          Lote <span className="font-mono font-bold bg-gray-50 px-2 py-0.5 rounded">{result.batchNumber}</span>
        </p>
        {result.carrier && (
          <p className="text-gray-500 text-sm mb-6">🚚 {result.carrier}</p>
        )}

        {/* QR para el transportista */}
        <div className="bg-white border-2 border-gray-200 rounded-xl p-6 mb-6 inline-block">
          <QRCodeSVG value={verifyUrl} size={200} level="H" />
          <p className="text-xs text-gray-500 mt-3">Escaneá este QR para verificar el despacho</p>
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={resetSession}
            className="bg-green-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition"
          >
            Nuevo despacho
          </button>
          <button
            onClick={() => navigate('/batches')}
            className="bg-gray-50 text-gray-900 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
          >
            Ver lotes
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase: SCANNING ───
  const totalProducts = uniqueOrders.reduce((s, e) => s + e.order.items.reduce((si, i) => si + i.quantity, 0), 0);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sesión de despacho</h1>
          <p className="text-sm text-gray-500">
            {transportTransferMode
              ? <span className="text-blue-700 font-medium">🚚 Traslado realizado por el depósito</span>
              : selectedTransporter
                ? <span className="text-blue-700 font-medium">🚚 {selectedTransporter.name}</span>
                : 'Sin transportista definido'}
          </p>
          {transportTransferMode && (
            <p className="text-xs font-medium text-blue-700 mt-1">Modo activo: Llevar a transporte</p>
          )}
        </div>
        <button
          onClick={resetSession}
          className="text-gray-500 hover:text-red-700 text-sm transition"
        >
          ✕ Cancelar sesión
        </button>
      </div>

      {/* Counter */}
      <div className="bg-white rounded-xl border-2 border-green-200 p-5 mb-4 text-center">
        <p className="text-4xl font-bold text-green-700">{uniqueOrders.length}</p>
        <p className="text-sm text-gray-500 mt-1">
          pedido{uniqueOrders.length !== 1 ? 's' : ''} escaneado{uniqueOrders.length !== 1 ? 's' : ''} · {totalProducts} unidades
        </p>
        {transportTransferMode && transferSummary.length > 0 && (
          <p className="text-xs font-medium text-blue-700 mt-2">Se registrarán {transferSummary.length} traslado{transferSummary.length !== 1 ? 's' : ''} agrupado{transferSummary.length !== 1 ? 's' : ''} por cliente.</p>
        )}
      </div>

      {/* Scan input */}
      <div className="bg-white rounded-xl border-2 border-blue-200 p-5 mb-4">
        <label className="block text-sm font-medium text-gray-900 mb-2">
          Escanear SKU o QR de Mercado Libre
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Si el texto escaneado contiene shipments/, se procesa como QR de Mercado Libre. Si no, se mantiene el flujo por SKU.
        </p>
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={skuInput}
            onChange={(e) => setSkuInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleScan(); }}
            placeholder="Ingresá o escaneá un SKU o QR..."
            disabled={scanLoading}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-3.5 text-lg font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-50"
            autoComplete="off"
          />
          <button
            onClick={handleScan}
            disabled={scanLoading || !skuInput.trim()}
            className="ui-btn-primary px-6 py-3.5 rounded-xl text-sm font-bold disabled:opacity-50 whitespace-nowrap"
          >
            {scanLoading ? '...' : 'Escanear'}
          </button>
        </div>
        {lastDetectedType && !scanLoading && (
          <div className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${lastDetectedType === 'qr' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {lastDetectedType === 'qr' ? 'QR detectado' : 'SKU detectado'}
          </div>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-xl p-4 mb-4 text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : feedback.type === 'warning'
              ? 'bg-yellow-50 border border-yellow-200 text-yellow-800'
              : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {feedback.message}
        </div>
      )}

      {qrLookup && (
        <div className={`rounded-2xl border mb-4 overflow-hidden ${qrLookup.error ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-white'}`}>
          <div className="px-5 py-3 border-b border-inherit flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Resultado de QR de Mercado Libre</h2>
              <p className="text-xs text-gray-500 mt-1">
                {qrLookup.shippingId ? `shipping_id ${qrLookup.shippingId}` : 'QR sin shipping_id válido'}
              </p>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">QR detectado</span>
          </div>

          {qrLookup.loading ? (
            <div className="px-5 py-6 text-sm text-gray-500">Buscando pedido por shipping_id...</div>
          ) : qrLookup.error ? (
            <div className="px-5 py-6 text-sm text-red-700">{qrLookup.error}</div>
          ) : qrLookup.order ? (
            <div className="p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <div className="h-28 w-28 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 flex items-center justify-center shrink-0">
                  {qrLookup.order.items[0]?.product_image_url ? (
                    <img
                      src={qrLookup.order.items[0].product_image_url}
                      alt={qrLookup.order.items[0]?.product_name ?? qrLookup.order.items[0]?.sku ?? qrLookup.order.order_number}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="px-3 text-center text-xs font-semibold text-gray-500">
                      {qrLookup.order.items[0]?.sku ?? 'Sin imagen'}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Pedido encontrado</p>
                    <h3 className="text-lg font-bold text-gray-900">{qrLookup.order.items[0]?.product_name ?? qrLookup.order.items[0]?.sku ?? qrLookup.order.order_number}</h3>
                    <p className="text-sm text-gray-500">
                      {qrLookup.order.order_number}
                      {qrLookup.order.items.length > 1 ? ` · +${qrLookup.order.items.length - 1} producto${qrLookup.order.items.length - 1 !== 1 ? 's' : ''}` : ''}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dirección</p>
                      <p className="mt-1 text-sm text-gray-900">{buildOrderAddress(qrLookup.order) || 'Sin dirección registrada'}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</p>
                      <p className={`mt-1 text-sm font-semibold ${qrLookup.order.status === 'dispatched' ? 'text-yellow-700' : qrLookup.order.status === 'prepared' ? 'text-green-700' : 'text-gray-900'}`}>
                        {formatOrderStatus(qrLookup.order.status)}
                      </p>
                    </div>
                  </div>

                  {qrLookup.order.status === 'dispatched' && (
                    <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                      Este pedido ya fue despachado. La acción quedó bloqueada para evitar duplicados.
                    </div>
                  )}

                  {qrLookup.order.status !== 'prepared' && qrLookup.order.status !== 'dispatched' && (
                    <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                      El pedido no está listo para despacho. Debe estar en estado "Listo para despacho" para confirmarlo desde QR.
                    </div>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={handleConfirmQrDispatch}
                      disabled={qrDispatchLoading || qrLookup.order.status !== 'prepared'}
                      className="ui-btn-primary rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50"
                    >
                      {qrDispatchLoading ? 'Confirmando...' : 'Confirmar despacho'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrLookup(null)}
                      className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
                    >
                      Limpiar resultado QR
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Scanned orders list */}
      {uniqueOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
          <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">Pedidos escaneados</h2>
            <span className="text-xs text-gray-500">{uniqueOrders.length} pedido{uniqueOrders.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {uniqueOrders.map((entry) => (
              <div key={entry.order.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50">
                <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-700 text-sm flex-shrink-0">
                  ✓
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-gray-900">{entry.order.order_number}</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs text-gray-500">{entry.order.client_name ?? `#${entry.order.client_id}`}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {entry.order.items.map((item) => (
                      <span key={item.id} className="text-xs bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded font-mono">
                        {item.sku} ×{item.quantity}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => removeEntry(entry.order.id)}
                  className="text-border hover:text-red-700 text-sm transition flex-shrink-0"
                  title="Quitar de la lista"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {uniqueOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <label htmlFor="dispatch-notes" className="block text-sm font-medium text-gray-900 mb-2">
            Observaciones (opcional)
          </label>
          <textarea
            id="dispatch-notes"
            value={dispatchNotes}
            onChange={(e) => setDispatchNotes(e.target.value)}
            placeholder="Ej: falta 1 unidad, caja dañada, envío parcial..."
            rows={4}
            className="w-full resize-y rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {quickNotes.map((note) => (
              <button
                key={note}
                type="button"
                onClick={() => applyQuickNote(note)}
                className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-900 hover:border-green-200 hover:bg-green-50 hover:text-green-700 transition"
              >
                {note}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Finalize button */}
      {uniqueOrders.length > 0 && (
        <button
          onClick={() => setShowConfirm(true)}
          className="w-full bg-green-600 text-white py-4 rounded-xl text-lg font-bold hover:opacity-90 transition"
        >
          {transportTransferMode
            ? `🚚 Confirmar salida a transporte (${transferSummary.length} traslado${transferSummary.length !== 1 ? 's' : ''})`
            : `🚚 Finalizar despacho (${uniqueOrders.length} pedido${uniqueOrders.length !== 1 ? 's' : ''})`}
        </button>
      )}

      {/* Conflict resolution modal */}
      {conflict && (
        <div className="app-modal-overlay bg-text-blue-700/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Múltiples pedidos encontrados</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  SKU <span className="font-mono font-bold text-blue-700">{conflict.sku}</span> pertenece a {conflict.candidates.length} pedidos — seleccioná uno
                </p>
              </div>
              <button
                onClick={handleCloseConflict}
                className="text-gray-500 hover:text-gray-500 text-xl leading-none"
              >✕</button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {conflict.candidates.map((order) => {
                const totalItems = order.items.reduce((sum, i) => sum + i.quantity, 0);

                return (
                  <button
                    key={order.id}
                    onClick={() => handlePickConflict(order)}
                    className="w-full text-left bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl p-4 transition group"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-sm font-bold text-gray-900 group-hover:text-blue-700">
                        {order.order_number}
                      </span>
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        {totalItems} producto{totalItems !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500">
                      <span className="font-medium">{order.client_name ?? `Cliente #${order.client_id}`}</span>
                      {order.buyer_name && (
                        <span className="text-gray-500"> · {order.buyer_name}</span>
                      )}
                    </div>
                    {(order.address_line || order.city || order.state) ? (
                      <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                        {order.address_line && <div>📍 {order.address_line}</div>}
                        <div>
                          {order.city && <span className="font-semibold">{order.city}</span>}
                          {order.city && order.state && <span>, </span>}
                          {order.state && <span>{order.state}</span>}
                          {order.postal_code && <span className="text-gray-500"> ({order.postal_code})</span>}
                        </div>
                      </div>
                    ) : order.buyer_address ? (
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        📍 {order.buyer_address}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2 mt-2">
                      {order.items.map((item) => (
                        <span
                          key={item.id}
                          className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                            item.sku === conflict.sku
                              ? 'bg-blue-50 text-blue-700 font-bold'
                              : 'bg-gray-50 text-gray-500'
                          }`}
                        >
                          {item.sku} ×{item.quantity}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleCloseConflict}
              className="w-full mt-4 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <div className="app-modal-overlay bg-text-blue-700/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-3">{transportTransferMode ? 'Confirmar salida a transporte' : 'Confirmar despacho'}</h3>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 text-center">
              {transportTransferMode ? (
                <>
                  <p className="text-3xl font-bold text-green-700">{transferSummary.length}</p>
                  <p className="text-sm text-green-700">
                    traslado{transferSummary.length !== 1 ? 's' : ''} · {totalProducts} unidades
                  </p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-green-700">{uniqueOrders.length}</p>
                  <p className="text-sm text-green-700">
                    pedido{uniqueOrders.length !== 1 ? 's' : ''} · {totalProducts} unidades
                  </p>
                </>
              )}
            </div>

            {transportTransferMode ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 mb-4">
                <p className="text-sm text-blue-800 font-medium mb-2">Se generarán {transferSummary.length} traslados:</p>
                <div className="space-y-2">
                  {transferSummary.map((item) => (
                    <div key={item.clientId} className="flex items-center justify-between gap-3 text-sm text-blue-900">
                      <span className="font-medium">{item.clientName}</span>
                      <span>{item.productCount} producto{item.productCount !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-800 font-medium">
                  ⚠ Verificá que el transportista tenga la misma cantidad de paquetes antes de confirmar.
                </p>
              </div>
            )}

            {selectedTransporter && (
              <p className="text-sm text-gray-500 mb-2">
                Transportista: <span className="font-medium text-blue-700">{selectedTransporter.name}</span>
              </p>
            )}

            {dispatchNotes.trim() && (
              <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Observaciones</p>
                <p className="whitespace-pre-wrap text-sm text-gray-900">{dispatchNotes.trim()}</p>
              </div>
            )}

            {dispatchError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{dispatchError}</div>
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setShowConfirm(false); setDispatchError(''); }}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Volver
              </button>
              <button
                onClick={handleConfirmDispatch}
                disabled={dispatchLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 bg-green-600 hover:opacity-90 text-white"
              >
                {dispatchLoading ? (transportTransferMode ? 'Registrando...' : 'Despachando...') : (transportTransferMode ? '✔ Confirmar y registrar traslados' : '✔ Confirmar despacho')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
