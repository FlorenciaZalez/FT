import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchOrders,
  createOrder,
  advanceOrder,
  cancelOrder,
  type Order,
  type OrderCreatePayload,
} from '../services/orders';

const AUTO_REFRESH_MS = 8_000;

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastParamsRef = useRef<{ status?: string; dominant_zone?: string }>({});

  const load = useCallback(async (status?: string, dominant_zone?: string) => {
    lastParamsRef.current = { status, dominant_zone };
    setLoading(true);
    setError(null);
    try {
      setOrders(await fetchOrders(status, dominant_zone));
    } catch {
      setError('Error al cargar pedidos');
    } finally {
      setLoading(false);
    }
  }, []);

  // Silent background refresh (no loading indicator)
  const silentRefresh = useCallback(async () => {
    const { status, dominant_zone } = lastParamsRef.current;
    try {
      const fresh = await fetchOrders(status, dominant_zone);
      setOrders(fresh);
    } catch {
      // silent — don't show error on background poll
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh polling
  useEffect(() => {
    const id = setInterval(silentRefresh, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [silentRefresh]);

  const add = async (payload: OrderCreatePayload) => {
    const created = await createOrder(payload);
    const { status, dominant_zone } = lastParamsRef.current;
    setOrders(await fetchOrders(status, dominant_zone));
    return created;
  };

  const advance = async (id: number) => {
    const updated = await advanceOrder(id);
    setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    return updated;
  };

  const cancel = async (id: number) => {
    const updated = await cancelOrder(id);
    setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    return updated;
  };

  return { orders, loading, error, reload: load, add, advance, cancel };
}
