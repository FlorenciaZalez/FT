import { useState, useEffect, type FormEvent } from 'react';
import api from '../api/api';

interface UserData {
  id: number;
  email: string;
  full_name: string;
  role: string;
  client_id: number | null;
  is_active: boolean;
  zones: string[] | null;
}

interface ClientData {
  id: number;
  name: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operario',
  client: 'Cliente',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-blue-50 text-blue-700',
  operator: 'bg-blue-50 text-blue-700',
  client: 'bg-green-50 text-green-700',
};

export default function Users() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [clients, setClients] = useState<ClientData[]>([]);
  const [availableZones, setAvailableZones] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, clientsRes, zonesRes] = await Promise.all([
        api.get('/auth/users'),
        api.get('/clients'),
        api.get('/locations/zones'),
      ]);
      setUsers(usersRes.data);
      setClients(clientsRes.data);
      setAvailableZones(zonesRes.data);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreated = () => {
    setShowModal(false);
    setEditingUser(null);
    fetchData();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-gray-500 text-sm mt-1">Administrá los usuarios del sistema</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="ui-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Nuevo usuario
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0 table-scroll-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Nombre</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Email</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Rol</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Zonas</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Cliente</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estado</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{user.full_name}</td>
                  <td className="px-6 py-4 text-gray-500">{user.email}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] ?? 'bg-gray-50 text-gray-900'}`}>
                      {ROLE_LABELS[user.role] ?? user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {user.zones && user.zones.length > 0 ? (
                      <div className="flex gap-1 flex-wrap">
                        {user.zones.map((z) => (
                          <span key={z} className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                            {z}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {user.client_id
                      ? clients.find((c) => c.id === user.client_id)?.name ?? `#${user.client_id}`
                      : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {user.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setEditingUser(user)}
                      className="text-blue-700 hover:text-blue-700 text-xs font-medium"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No hay usuarios registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CreateUserModal
          clients={clients}
          availableZones={availableZones}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          clients={clients}
          availableZones={availableZones}
          onClose={() => setEditingUser(null)}
          onSaved={handleCreated}
        />
      )}
    </div>
  );
}

function ZoneSelector({ availableZones, selected, onChange }: {
  availableZones: string[];
  selected: string[];
  onChange: (zones: string[]) => void;
}) {
  const toggle = (zone: string) => {
    onChange(
      selected.includes(zone) ? selected.filter((z) => z !== zone) : [...selected, zone].sort()
    );
  };
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">Zonas de trabajo</label>
      <div className="flex flex-wrap gap-2">
        {availableZones.length === 0 && (
          <span className="text-xs text-gray-500">No hay zonas disponibles</span>
        )}
        {availableZones.map((zone) => (
          <button
            key={zone}
            type="button"
            onClick={() => toggle(zone)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              selected.includes(zone)
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
            }`}
          >
            Zona {zone}
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateUserModal({
  clients,
  availableZones,
  onClose,
  onCreated,
}: {
  clients: ClientData[];
  availableZones: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('client');
  const [clientId, setClientId] = useState<string>('');
  const [zones, setZones] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', {
        email,
        password,
        full_name: fullName,
        role,
        client_id: role === 'client' && clientId ? parseInt(clientId) : null,
        zones: zones.length > 0 ? zones : null,
      });
      onCreated();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al crear usuario';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Nuevo usuario</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nombre completo</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Juan Pérez"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="juan@email.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Contraseña</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="admin">Administrador</option>
              <option value="operator">Operario</option>
              <option value="client">Cliente</option>
            </select>
          </div>

          {role === 'client' && (
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Cliente asociado</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              >
                <option value="">Seleccionar cliente...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {role === 'operator' && (
            <ZoneSelector availableZones={availableZones} selected={zones} onChange={setZones} />
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({
  user,
  clients,
  availableZones,
  onClose,
  onSaved,
}: {
  user: UserData;
  clients: ClientData[];
  availableZones: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState(user.role);
  const [clientId, setClientId] = useState<string>(user.client_id?.toString() ?? '');
  const [zones, setZones] = useState<string[]>(user.zones ?? []);
  const [isActive, setIsActive] = useState(user.is_active);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.put(`/auth/users/${user.id}`, {
        full_name: fullName,
        role,
        client_id: role === 'client' && clientId ? parseInt(clientId) : null,
        zones: zones.length > 0 ? zones : null,
        is_active: isActive,
      });
      onSaved();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        'Error al actualizar usuario';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-text-blue-700/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Editar usuario</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nombre completo</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Email</label>
            <input
              type="email"
              disabled
              value={user.email}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="admin">Administrador</option>
              <option value="operator">Operario</option>
              <option value="client">Cliente</option>
            </select>
          </div>

          {role === 'client' && (
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Cliente asociado</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              >
                <option value="">Seleccionar cliente...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {role === 'operator' && (
            <ZoneSelector availableZones={availableZones} selected={zones} onChange={setZones} />
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 text-blue-700 border-gray-200 rounded focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-900">Usuario activo</label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="ui-btn-primary flex-1 px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
