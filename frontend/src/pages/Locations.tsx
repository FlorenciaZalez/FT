import { useState, useEffect, useMemo, type FormEvent } from 'react';
import {
  fetchLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  type Location,
  type LocationCreatePayload,
} from '../services/locations';
import SuccessToast from '../components/SuccessToast';

export default function Locations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingLoc, setEditingLoc] = useState<Location | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Location | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterAisle, setFilterAisle] = useState('');

  const loadLocations = () => {
    setLoading(true);
    fetchLocations()
      .then(setLocations)
      .catch(() => setError('Error al cargar ubicaciones'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadLocations(); }, []);

  // Unique zones and aisles for filter dropdowns
  const zones = useMemo(() => [...new Set(locations.map((l) => l.zone))].sort(), [locations]);
  const aisles = useMemo(() => {
    const filtered = filterZone
      ? locations.filter((l) => l.zone === filterZone)
      : locations;
    return [...new Set(filtered.map((l) => l.aisle))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [locations, filterZone]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = locations;
    if (filterZone) list = list.filter((l) => l.zone === filterZone);
    if (filterAisle) list = list.filter((l) => l.aisle === filterAisle);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.code.toLowerCase().includes(q) ||
          (l.description?.toLowerCase().includes(q) ?? false),
      );
    }
    return list;
  }, [locations, filterZone, filterAisle, search]);

  const handleCreated = (loc: Location) => {
    setLocations((prev) => [...prev, loc].sort((a, b) => a.code.localeCompare(b.code)));
    setShowCreate(false);
    setSuccessMsg(`Ubicación ${loc.code} creada`);
  };

  const handleToggle = async (loc: Location) => {
    setActionLoading(loc.id);
    setActionError('');
    try {
      const updated = await updateLocation(loc.id, { is_active: !loc.is_active });
      setLocations((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch {
      setActionError('Error al cambiar estado');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (loc: Location) => {
    setActionLoading(loc.id);
    setActionError('');
    try {
      await deleteLocation(loc.id);
      setLocations((prev) => prev.filter((l) => l.id !== loc.id));
      setConfirmDelete(null);
      setSuccessMsg(`Ubicación ${loc.code} eliminada`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al eliminar';
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleEditSaved = (updated: Location) => {
    setLocations((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setEditingLoc(null);
    setSuccessMsg('Ubicación actualizada');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ubicaciones</h1>
          <p className="text-gray-500 text-sm mt-1">
            Gestión de ubicaciones del depósito · {filtered.length} ubicaci{filtered.length !== 1 ? 'ones' : 'ón'}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Nueva ubicación
        </button>
      </div>

      {(error || actionError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error || actionError}</div>
      )}

      {successMsg && <SuccessToast message={successMsg} onClose={() => setSuccessMsg('')} />}

      {showCreate && (
        <CreateLocationForm
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Buscar por código..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-56 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <select
          value={filterZone}
          onChange={(e) => { setFilterZone(e.target.value); setFilterAisle(''); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">Todos los pasillos</option>
          {zones.map((z) => (
            <option key={z} value={z}>Pasillo {z}</option>
          ))}
        </select>
        <select
          value={filterAisle}
          onChange={(e) => setFilterAisle(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">Todas las estanterías</option>
          {aisles.map((a) => (
            <option key={a} value={a}>Estantería {a}</option>
          ))}
        </select>
        {(search || filterZone || filterAisle) && (
          <button
            onClick={() => { setSearch(''); setFilterZone(''); setFilterAisle(''); }}
            className="text-sm text-gray-500 hover:text-gray-900 px-2"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando ubicaciones...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">No hay ubicaciones</p>
          <p className="text-gray-500 text-sm">Creá la primera con el botón de arriba.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0 table-scroll-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Código</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Pasillo</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estantería</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Nivel</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Posición</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Descripción</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estado</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((loc) => (
                <tr
                  key={loc.id}
                  className={`border-b border-gray-200 hover:bg-gray-50 ${!loc.is_active ? 'opacity-50' : ''}`}
                >
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-bold bg-gray-50 text-gray-900 px-2 py-1 rounded">{loc.code}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-700 text-xs font-bold">
                      {loc.zone}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-900">{loc.aisle}</td>
                  <td className="px-6 py-4 text-gray-900">{loc.shelf}</td>
                  <td className="px-6 py-4 text-gray-900">{loc.position}</td>
                  <td className="px-6 py-4 text-gray-500 text-xs truncate max-w-[200px]">{loc.description || '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      loc.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'
                    }`}>
                      {loc.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingLoc(loc)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleToggle(loc)}
                        disabled={actionLoading === loc.id}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-50 ${
                          loc.is_active
                            ? 'text-yellow-800 bg-yellow-50 hover:bg-yellow-50'
                            : 'text-green-700 bg-green-50 hover:bg-green-50'
                        }`}
                      >
                        {loc.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(loc)}
                        className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-50 transition"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editingLoc && (
        <EditLocationModal
          location={editingLoc}
          onClose={() => setEditingLoc(null)}
          onSaved={handleEditSaved}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Eliminar ubicación</h3>
            <p className="text-sm text-gray-500 mb-5">
              ¿Eliminar <strong>{confirmDelete.code}</strong>? Esta acción no se puede deshacer.
            </p>
            {actionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{actionError}</div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDelete(null); setActionError(''); }}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={actionLoading === confirmDelete.id}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {actionLoading === confirmDelete.id ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Create Form ─── */
function CreateLocationForm({
  onCreated,
  onCancel,
}: {
  onCreated: (loc: Location) => void;
  onCancel: () => void;
}) {
  const [zone, setZone] = useState('');
  const [aisle, setAisle] = useState('');
  const [shelf, setShelf] = useState('');
  const [position, setPosition] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const previewCode = zone && aisle && shelf
    ? `${zone.toUpperCase()}-${aisle.padStart(2, '0')}-${shelf.padStart(2, '0')}-${(position || '1').padStart(2, '0')}`
    : '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!zone.trim() || !aisle.trim() || !shelf.trim()) {
      setFormError('Completá pasillo, estantería y nivel');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const payload: LocationCreatePayload = {
        zone: zone.trim().toUpperCase(),
        aisle: aisle.trim(),
        shelf: shelf.trim(),
        position: (position.trim() || '1'),
        description: description.trim() || undefined,
      };
      const loc = await createLocation(payload);
      onCreated(loc);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al crear ubicación';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Nueva ubicación</h2>

      {formError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{formError}</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Pasillo</label>
            <input
              type="text"
              required
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="A"
              maxLength={5}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm uppercase focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Estantería</label>
            <input
              type="number"
              required
              min={1}
              value={aisle}
              onChange={(e) => setAisle(e.target.value)}
              placeholder="1"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nivel</label>
            <input
              type="number"
              required
              min={1}
              value={shelf}
              onChange={(e) => setShelf(e.target.value)}
              placeholder="1"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Posición</label>
            <input
              type="number"
              min={1}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="1"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-900 mb-1">
            Descripción <span className="text-gray-500 font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Zona de productos frágiles"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {previewCode && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-xs text-blue-700 font-medium">Código generado: </span>
            <span className="font-mono text-sm font-bold text-blue-700">{previewCode}</span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear ubicación'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─── Edit Modal ─── */
function EditLocationModal({
  location,
  onClose,
  onSaved,
}: {
  location: Location;
  onClose: () => void;
  onSaved: (loc: Location) => void;
}) {
  const [description, setDescription] = useState(location.description ?? '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const updated = await updateLocation(location.id, {
        description: description.trim() || undefined,
      });
      onSaved(updated);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al actualizar';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">Editar ubicación</h3>
        <p className="text-sm text-gray-500 mb-4 font-mono">{location.code}</p>

        {formError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{formError}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-900 mb-1">Descripción</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción de la ubicación..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
