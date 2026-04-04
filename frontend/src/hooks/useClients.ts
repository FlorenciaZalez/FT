import { useState, useEffect, useCallback } from 'react';
import {
  fetchClients,
  createClient,
  updateClient,
  deleteClient,
  type Client,
  type ClientCreatePayload,
  type ClientUpdatePayload,
} from '../services/clients';

export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchClients();
      setClients(data);
    } catch {
      setError('Error al cargar clientes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (payload: ClientCreatePayload) => {
    const created = await createClient(payload);
    setClients((prev) => [...prev, created]);
    return created;
  };

  const update = async (id: number, payload: ClientUpdatePayload) => {
    const updated = await updateClient(id, payload);
    setClients((prev) => prev.map((c) => (c.id === id ? updated : c)));
    return updated;
  };

  const toggleActive = async (id: number, currentlyActive: boolean) => {
    return update(id, { is_active: !currentlyActive });
  };

  const remove = async (id: number) => {
    await deleteClient(id);
    setClients((prev) => prev.filter((c) => c.id !== id));
  };

  return { clients, loading, error, reload: load, add, update, toggleActive, remove };
}
