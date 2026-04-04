import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/api';

interface BatchInfo {
  batch_number: string;
  transporter_name: string | null;
  attempts_used: number;
  max_attempts: number;
  locked: boolean;
  verified: boolean;
}

interface VerifyResult {
  match: boolean;
  locked: boolean;
  verified: boolean;
  attempts_used?: number;
  message: string;
}

export default function DispatchVerify() {
  const { batchNumber } = useParams<{ batchNumber: string }>();
  const [batch, setBatch] = useState<BatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [count, setCount] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const loadBatch = useCallback(async () => {
    if (!batchNumber) return;
    try {
      const { data } = await api.get<BatchInfo>(`/dispatch/${batchNumber}`);
      setBatch(data);
      if (data.verified) {
        setResult({ match: true, locked: false, verified: true, message: 'Cantidad correcta. Podés iniciar el recorrido.' });
      } else if (data.locked) {
        setResult({ match: false, locked: true, verified: false, message: 'Máximo de intentos alcanzado. Contactar al operador.' });
      }
    } catch {
      setError('No se pudo cargar la información del lote.');
    } finally {
      setLoading(false);
    }
  }, [batchNumber]);

  useEffect(() => { loadBatch(); }, [loadBatch]);

  const handleVerify = async () => {
    if (!batchNumber || count === '') return;
    setVerifying(true);
    try {
      const { data } = await api.post<VerifyResult>(`/dispatch/${batchNumber}/verify`, {
        entered_count: parseInt(count, 10),
      });
      setResult(data);
      if (data.attempts_used !== undefined && batch) {
        setBatch({ ...batch, attempts_used: data.attempts_used, locked: data.locked, verified: data.verified });
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al verificar';
      setResult({ match: false, locked: false, verified: false, message: msg });
    } finally {
      setVerifying(false);
    }
  };

  // ── Full-screen result states ──
  if (result?.verified) {
    return (
      <div className="min-h-screen bg-green-600 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-8xl mb-6">✅</div>
          <h1 className="text-3xl font-bold text-white mb-3">Verificación exitosa</h1>
          <p className="text-xl text-white">{result.message}</p>
          <div className="mt-8 bg-white/20 rounded-2xl p-4">
            <p className="text-white text-sm">Lote</p>
            <p className="text-white text-lg font-bold">{batch?.batch_number}</p>
          </div>
        </div>
      </div>
    );
  }

  if (result?.locked) {
    return (
      <div className="min-h-screen bg-red-600 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-8xl mb-6">🚫</div>
          <h1 className="text-3xl font-bold text-white mb-3">Verificación bloqueada</h1>
          <p className="text-xl text-white">{result.message}</p>
          <div className="mt-8 bg-white/20 rounded-2xl p-4">
            <p className="text-white text-sm">Lote</p>
            <p className="text-white text-lg font-bold">{batch?.batch_number}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading / Error ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-lg">Cargando...</p>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <p className="text-red-700 text-lg font-medium">{error || 'Lote no encontrado'}</p>
        </div>
      </div>
    );
  }

  // ── Mismatch result (still has attempts) ──
  const showMismatch = result && !result.match && !result.locked;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-xl font-bold text-gray-900 text-center">Validación de despacho</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-md mx-auto w-full">
        {/* Batch info */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 w-full mb-6 shadow-sm">
          <div className="text-center space-y-2">
            <p className="text-sm text-gray-500">Lote</p>
            <p className="text-2xl font-bold text-gray-900">{batch.batch_number}</p>
            {batch.transporter_name && (
              <>
                <p className="text-sm text-gray-500 mt-3">Transportista</p>
                <p className="text-lg font-semibold text-gray-900">{batch.transporter_name}</p>
              </>
            )}
          </div>
        </div>

        {/* Mismatch warning */}
        {showMismatch && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-5 w-full mb-6 text-center">
            <div className="text-4xl mb-2">❌</div>
            <p className="text-red-700 font-bold text-lg">{result.message}</p>
          </div>
        )}

        {/* Input */}
        <div className="w-full mb-6">
          <label className="block text-sm font-medium text-gray-500 text-center mb-3">
            Ingresá la cantidad de paquetes
          </label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={count}
            onChange={(e) => { setCount(e.target.value); setResult(null); }}
            placeholder="0"
            className="w-full text-center text-5xl font-bold py-5 px-4 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500 transition"
            autoFocus
          />
          {batch.attempts_used > 0 && (
            <p className="text-center text-sm text-gray-500 mt-2">
              Intento {batch.attempts_used} de {batch.max_attempts}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={handleVerify}
          disabled={verifying || count === '' || parseInt(count, 10) < 0}
          className="ui-btn-primary w-full py-5 text-xl font-bold rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
        >
          {verifying ? 'Verificando...' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
