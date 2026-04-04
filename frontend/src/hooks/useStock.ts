import { useState, useEffect, useCallback } from 'react';
import {
  fetchStock,
  stockIn,
  stockOut,
  type StockFilters,
  type StockItem,
  type StockInPayload,
  type StockOutPayload,
} from '../services/stock';

export function useStock(filters: StockFilters = {}) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchStock(filters));
    } catch {
      setError('Error al cargar stock');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const addStock = async (payload: StockInPayload) => {
    const result = await stockIn(payload);
    await load(); // reload to get updated quantities
    return result;
  };

  const removeStock = async (payload: StockOutPayload) => {
    const result = await stockOut(payload);
    await load();
    return result;
  };

  return { items, loading, error, reload: load, addStock, removeStock };
}
