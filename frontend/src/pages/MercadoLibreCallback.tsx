import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { mlCallback } from '../services/mercadolibre';

export default function MercadoLibreCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const parsedClientId = state ? Number.parseInt(state, 10) : Number.NaN;
  const validationError = !code || !state
    ? 'Parámetros de autorización inválidos'
    : Number.isNaN(parsedClientId)
      ? 'ID de cliente inválido'
      : '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(validationError ? 'error' : 'loading');
  const [errorMsg, setErrorMsg] = useState(validationError);

  useEffect(() => {
    if (validationError) {
      return;
    }

    const authorizationCode = code ?? '';
    const clientId = parsedClientId;

    mlCallback(authorizationCode, clientId)
      .then(() => {
        setStatus('success');
        setTimeout(() => navigate(`/clients/${clientId}`), 2000);
      })
      .catch(() => {
        setStatus('error');
        setErrorMsg('Error al conectar la cuenta de Mercado Libre');
      });
  }, [code, parsedClientId, validationError, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
        {status === 'loading' && (
          <>
            <div className="mx-auto w-10 h-10 border-4 border-yellow-200 border-t-transparent rounded-full animate-spin mb-4" />
            <h2 className="text-lg font-bold text-gray-900">Conectando Mercado Libre</h2>
            <p className="text-sm text-gray-500 mt-1">Procesando autorización...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="text-4xl mb-3">✅</div>
            <h2 className="text-lg font-bold text-gray-900">Cuenta conectada</h2>
            <p className="text-sm text-gray-500 mt-1">Redirigiendo al cliente...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-4xl mb-3">❌</div>
            <h2 className="text-lg font-bold text-red-700">Error</h2>
            <p className="text-sm text-gray-500 mt-2">{errorMsg}</p>
            <button
              onClick={() => navigate('/clients')}
              className="ui-btn-primary mt-4 px-4 py-2 text-sm rounded-lg"
            >
              Volver a clientes
            </button>
          </>
        )}
      </div>
    </div>
  );
}
