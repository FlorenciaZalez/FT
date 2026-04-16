import { useState, useEffect, useCallback } from 'react';
import {
  fetchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  type Product,
  type ProductCreatePayload,
  type ProductUpdatePayload,
} from '../services/products';

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProducts();
      setProducts(data);
    } catch {
      setError('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (payload: ProductCreatePayload) => {
    const created = await createProduct(payload);
    setProducts((prev) => {
      const exists = prev.some((product) => product.id === created.id);
      return exists ? prev.map((product) => (product.id === created.id ? created : product)) : [...prev, created];
    });
    return created;
  };

  const update = async (id: number, payload: ProductUpdatePayload) => {
    const updated = await updateProduct(id, payload);
    setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
    return updated;
  };

  const toggleActive = async (id: number, currentlyActive: boolean) => {
    return update(id, { is_active: !currentlyActive });
  };

  const remove = async (id: number) => {
    await deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  return { products, loading, error, reload: load, add, update, toggleActive, remove };
}
