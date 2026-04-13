import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createTransporter,
  deleteTransporter,
  downloadTransporterDocument,
  fetchTransporterDocuments,
  fetchTransporters,
  updateTransporter,
  type Transporter,
  type TransporterCreatePayload,
  type TransporterDocument,
  type TransporterDocumentPayload,
  type TransporterDocumentStatus,
  type TransporterDocumentType,
} from '../services/transporters';
import SuccessToast from '../components/SuccessToast';

const DOCUMENT_LABELS: Record<TransporterDocumentType, string> = {
  dni: 'DNI',
  seguro: 'Seguro',
  cedula_verde: 'Cédula verde',
};

const DOCUMENT_STATUS_CONFIG: Record<TransporterDocumentStatus, { label: string; className: string }> = {
  completo: { label: '✔ Completo', className: 'bg-green-50 text-green-700 border-green-200' },
  incompleto: { label: '⚠ Incompleto', className: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  vencido: { label: '🔴 Vencido', className: 'bg-red-50 text-red-700 border-red-200' },
  por_vencer: { label: '🟡 Por vencer', className: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('es-AR');
}

function getMissingDocuments(transporter: Transporter): string[] {
  return transporter.missing_documents;
}

function getDocumentSummary(transporter: Transporter): string {
  if (transporter.document_status === 'vencido') {
    return `Venció: ${transporter.expiring_documents.join(', ')}`;
  }
  if (transporter.document_status === 'por_vencer') {
    return `Por vencer: ${transporter.expiring_documents.join(', ')}`;
  }
  if (transporter.document_status === 'incompleto') {
    return `Falta: ${transporter.missing_documents.join(', ')}`;
  }
  return 'Todos los documentos presentes y vigentes';
}

function isPdfDocument(document: TransporterDocument): boolean {
  return document.content_type === 'application/pdf' || document.file_name.toLowerCase().endsWith('.pdf');
}

function isImageDocument(document: TransporterDocument): boolean {
  return document.content_type?.startsWith('image/') ?? /\.(png|jpg|jpeg|webp|gif)$/i.test(document.file_name);
}

async function fileToUploadPayload(file: File): Promise<TransporterDocumentPayload> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return {
    file_name: file.name,
    content_base64: btoa(binary),
  };
}

export default function Transporters() {
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<Transporter | null>(null);
  const [actionError, setActionError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [documentsTarget, setDocumentsTarget] = useState<Transporter | null>(null);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState('');

  const load = () => {
    setLoading(true);
    fetchTransporters()
      .then(setTransporters)
      .catch(() => setError('Error al cargar transportistas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = transporters;
    if (search.trim()) {
      const query = search.toLowerCase();
      list = list.filter(
        (item) =>
          item.name.toLowerCase().includes(query)
          || (item.domicilio ?? '').toLowerCase().includes(query)
          || (item.phone ?? '').toLowerCase().includes(query),
      );
    }
    if (filterActive === 'active') list = list.filter((item) => item.active);
    if (filterActive === 'inactive') list = list.filter((item) => !item.active);
    return list;
  }, [transporters, search, filterActive]);

  const handleToggle = async (transporter: Transporter) => {
    setActionError('');
    try {
      const updated = await updateTransporter(transporter.id, { active: !transporter.active });
      setTransporters((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch {
      setActionError('Error al cambiar estado');
    }
  };

  const handleCreated = (transporter: Transporter) => {
    setTransporters((prev) => [...prev, transporter].sort((left, right) => left.name.localeCompare(right.name)));
    setShowCreate(false);
    setSuccessMsg(`Transportista "${transporter.name}" creado`);
  };

  const handleUpdated = (transporter: Transporter) => {
    setTransporters((prev) => prev.map((item) => (item.id === transporter.id ? transporter : item)));
    setEditingItem(null);
    setSuccessMsg(`Transportista "${transporter.name}" actualizado`);
  };

  const handleDeleted = (id: number) => {
    setTransporters((prev) => prev.filter((item) => item.id !== id));
    setEditingItem(null);
    setSuccessMsg('Transportista eliminado correctamente');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transportistas</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gestión y auditoría documental de transportistas</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditingItem(null); }}
          className="ui-btn-primary px-4 py-2.5 rounded-lg text-sm font-medium"
        >
          + Nuevo transportista
        </button>
      </div>

      {(error || actionError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error || actionError}</div>
      )}

      {successMsg && <SuccessToast message={successMsg} onClose={() => setSuccessMsg('')} />}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar transportista..."
            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={filterActive}
          onChange={(event) => setFilterActive(event.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando transportistas...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-2">
            {transporters.length === 0 ? 'No hay transportistas' : 'Sin resultados'}
          </p>
          <p className="text-gray-500 text-sm">
            {transporters.length === 0
              ? 'Creá el primero haciendo clic en "+ Nuevo transportista"'
              : 'Probá con otra búsqueda o ajustá los filtros.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-y-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-500">Nombre</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Domicilio</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Teléfono</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Documentación</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Estado</th>
                <th className="text-right px-6 py-3 font-medium text-gray-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((transporter) => {
                const statusConfig = DOCUMENT_STATUS_CONFIG[transporter.document_status];
                const missingDocuments = getMissingDocuments(transporter);

                return (
                  <tr key={transporter.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{transporter.name}</td>
                    <td className="px-6 py-4 text-gray-500">{transporter.domicilio || '—'}</td>
                    <td className="px-6 py-4 text-gray-500">{transporter.phone || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5">
                        <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusConfig.className}`}>
                          {statusConfig.label}
                        </span>
                        <span className="text-xs text-gray-500">{getDocumentSummary(transporter)}</span>
                        {missingDocuments.length > 0 && (
                          <span className="text-[11px] text-yellow-800">Pendientes: {missingDocuments.join(', ')}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        transporter.active ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'
                      }`}>
                        {transporter.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setDocumentsTarget(transporter)}
                          className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-50 transition"
                        >
                          Ver docs
                        </button>
                        <button
                          onClick={() => { setEditingItem(transporter); setShowCreate(false); }}
                          className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-50 rounded-lg hover:bg-gray-200 transition"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleToggle(transporter)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                            transporter.active
                              ? 'text-red-700 bg-red-50 hover:bg-red-50'
                              : 'text-green-700 bg-green-50 hover:bg-green-50'
                          }`}
                        >
                          {transporter.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <TransporterForm onClose={() => setShowCreate(false)} onSaved={handleCreated} />
      )}

      {editingItem && (
        <TransporterForm
          transporter={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}

      {documentsTarget && (
        <TransporterDocumentsModal transporter={documentsTarget} onClose={() => setDocumentsTarget(null)} />
      )}
    </div>
  );
}

function TransporterForm({
  transporter,
  onClose,
  onSaved,
  onDeleted,
}: {
  transporter?: Transporter;
  onClose: () => void;
  onSaved: (transporter: Transporter) => void;
  onDeleted?: (id: number) => void;
}) {
  const isEdit = Boolean(transporter);
  const [name, setName] = useState(transporter?.name ?? '');
  const [phone, setPhone] = useState(transporter?.phone ?? '');
  const [domicilio, setDomicilio] = useState(transporter?.domicilio ?? '');
  const [active, setActive] = useState(transporter?.active ?? true);
  const [insuranceExpirationDate, setInsuranceExpirationDate] = useState(transporter?.insurance_expiration_date ?? '');
  const [licenseExpirationDate, setLicenseExpirationDate] = useState(transporter?.license_expiration_date ?? '');
  const [dniFile, setDniFile] = useState<File | null>(null);
  const [seguroFile, setSeguroFile] = useState<File | null>(null);
  const [cedulaVerdeFile, setCedulaVerdeFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const missingDocuments = [
    !(dniFile || transporter?.dni_file_url) && 'DNI',
    !(seguroFile || transporter?.seguro_file_url) && 'Seguro',
    !(cedulaVerdeFile || transporter?.cedula_verde_file_url) && 'Cédula verde',
  ].filter(Boolean) as string[];

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError('');
    try {
      const payload: TransporterCreatePayload = {
        name: name.trim(),
        zone: null,
        phone: phone.trim() || null,
        domicilio: domicilio.trim() || null,
        insurance_expiration_date: insuranceExpirationDate || null,
        license_expiration_date: licenseExpirationDate || null,
        active,
      };
      if (dniFile) payload.dni_file = await fileToUploadPayload(dniFile);
      if (seguroFile) payload.seguro_file = await fileToUploadPayload(seguroFile);
      if (cedulaVerdeFile) payload.cedula_verde_file = await fileToUploadPayload(cedulaVerdeFile);

      const result = isEdit
        ? await updateTransporter(transporter!.id, payload)
        : await createTransporter(payload);
      onSaved(result);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al guardar';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!transporter) return;
    setDeleting(true);
    setError('');
    try {
      await deleteTransporter(transporter.id);
      onDeleted?.(transporter.id);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al eliminar';
      setError(message);
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">
            {isEdit ? 'Editar transportista' : 'Nuevo transportista'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl leading-none">✕</button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className={`rounded-lg border px-3 py-2 text-sm ${missingDocuments.length === 0 ? 'border-green-200 bg-green-50 text-green-700' : 'border-yellow-200 bg-yellow-50 text-yellow-800'}`}>
            {missingDocuments.length === 0
              ? '✔ Documentación base cargada'
              : `⚠ Falta documentación: ${missingDocuments.join(', ')}`}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Nombre *</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Ej: Andreani, OCA..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Domicilio</label>
            <input
              type="text"
              value={domicilio}
              onChange={(event) => setDomicilio(event.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Ej: Av. Siempre Viva 123"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Teléfono</label>
            <input
              type="text"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Ej: +54 11 1234-5678"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Vencimiento seguro</label>
              <input
                type="date"
                value={insuranceExpirationDate}
                onChange={(event) => setInsuranceExpirationDate(event.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Vencimiento licencia</label>
              <input
                type="date"
                value={licenseExpirationDate}
                onChange={(event) => setLicenseExpirationDate(event.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Documentación</h4>
              <p className="text-xs text-gray-500 mt-1">Los archivos quedan disponibles para ver, descargar y auditar desde la tabla.</p>
            </div>
            <DocumentInput
              label="DNI"
              fileUrl={transporter?.dni_file_url ?? null}
              currentFileName={transporter?.dni_file_name ?? null}
              selectedFileName={dniFile?.name ?? null}
              onFileChange={setDniFile}
            />
            <DocumentInput
              label="Seguro"
              fileUrl={transporter?.seguro_file_url ?? null}
              currentFileName={transporter?.seguro_file_name ?? null}
              selectedFileName={seguroFile?.name ?? null}
              onFileChange={setSeguroFile}
            />
            <DocumentInput
              label="Cédula verde"
              fileUrl={transporter?.cedula_verde_file_url ?? null}
              currentFileName={transporter?.cedula_verde_file_name ?? null}
              selectedFileName={cedulaVerdeFile?.name ?? null}
              onFileChange={setCedulaVerdeFile}
            />
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                className="rounded border-gray-200"
              />
              <label htmlFor="active" className="text-sm text-gray-900">Activo</label>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="ui-btn-primary flex-1 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Guardando...' : isEdit ? 'Guardar' : 'Crear'}
            </button>
          </div>

          {isEdit && (
            <div className="border-t border-gray-200 pt-4 mt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg transition"
              >
                Eliminar transportista
              </button>
            </div>
          )}
        </form>
      </div>

      {showDeleteConfirm && (
        <div className="app-modal-overlay bg-text-blue-700/50 z-[10001]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Eliminar transportista</h3>
            <p className="text-sm text-gray-500 mb-6">
              Esta acción no se puede deshacer. ¿Seguro que querés eliminar este transportista?
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TransporterDocumentsModal({
  transporter,
  onClose,
}: {
  transporter: Transporter;
  onClose: () => void;
}) {
  const [documents, setDocuments] = useState<TransporterDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewDocument, setPreviewDocument] = useState<TransporterDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<TransporterDocumentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchTransporterDocuments(transporter.id)
      .then((items) => {
        if (cancelled) return;
        setDocuments(items);
        setPreviewDocument(items[0] ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setError('No se pudo cargar la documentación del transportista.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transporter.id]);

  const handleDownload = async (document: TransporterDocument) => {
    setDownloadingId(document.id);
    try {
      await downloadTransporterDocument(transporter.id, document.id);
    } catch {
      setError('No se pudo descargar el documento.');
    } finally {
      setDownloadingId(null);
    }
  };

  const currentStatus = DOCUMENT_STATUS_CONFIG[transporter.document_status];

  return (
    <div className="app-modal-overlay bg-text-blue-700/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Documentación de {transporter.name}</h3>
            <div className="flex items-center gap-3 mt-2">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${currentStatus.className}`}>
                {currentStatus.label}
              </span>
              <span className="text-sm text-gray-500">{getDocumentSummary(transporter)}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-500 text-xl leading-none">✕</button>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-0 min-h-0 flex-1">
          <div className="border-r border-gray-200 overflow-y-auto p-6 space-y-4">
            {loading ? (
              <div className="text-sm text-gray-500">Cargando documentación...</div>
            ) : documents.length === 0 ? (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                No hay documentos cargados para este transportista.
              </div>
            ) : (
              documents.map((document) => (
                <div key={document.id} className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{DOCUMENT_LABELS[document.document_type]}</div>
                      <div className="text-xs text-gray-500 mt-1 break-all">{document.file_name}</div>
                    </div>
                    <span className="text-[11px] rounded-full bg-white border border-gray-200 px-2 py-0.5 text-gray-500">
                      {isPdfDocument(document) ? 'PDF' : isImageDocument(document) ? 'Imagen' : 'Archivo'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-gray-500">
                    <div>Subido: {formatDate(document.uploaded_at)}</div>
                    {document.expiration_date && <div>Vence: {formatDate(document.expiration_date)}</div>}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewDocument(document)}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-50 transition"
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(document)}
                      disabled={downloadingId === document.id}
                      className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-50 transition disabled:opacity-50"
                    >
                      {downloadingId === document.id ? 'Descargando...' : 'Descargar'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-6 min-h-0 overflow-y-auto bg-gray-50">
            {!previewDocument ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500">
                Seleccioná un documento para previsualizar.
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="mb-4">
                  <div className="text-lg font-semibold text-gray-900">{DOCUMENT_LABELS[previewDocument.document_type]}</div>
                  <div className="text-sm text-gray-500 mt-1">{previewDocument.file_name}</div>
                </div>
                <div className="flex-1 rounded-xl border border-gray-200 bg-white overflow-hidden min-h-[420px]">
                  {isPdfDocument(previewDocument) ? (
                    <iframe title={previewDocument.file_name} src={previewDocument.url} className="w-full h-full min-h-[420px]" />
                  ) : isImageDocument(previewDocument) ? (
                    <div className="h-full overflow-auto p-4 flex items-start justify-center bg-gray-50">
                      <img src={previewDocument.url} alt={previewDocument.file_name} className="max-w-full h-auto rounded-lg shadow-sm" />
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <a
                        href={previewDocument.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-blue-700 hover:text-blue-700 hover:underline"
                      >
                        Abrir archivo en una nueva pestaña
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentInput({
  label,
  fileUrl,
  currentFileName,
  selectedFileName,
  onFileChange,
}: {
  label: string;
  fileUrl: string | null;
  currentFileName: string | null;
  selectedFileName: string | null;
  onFileChange: (file: File | null) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-50"
      />
      {selectedFileName && <p className="mt-1 text-xs text-green-700">Seleccionado: {selectedFileName}</p>}
      {fileUrl ? (
        <a href={fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-blue-700 hover:text-blue-700 hover:underline">
          Ver archivo actual{currentFileName ? ` · ${currentFileName}` : ''}
        </a>
      ) : (
        <p className="mt-1 text-xs text-yellow-800">No cargado</p>
      )}
    </div>
  );
}
