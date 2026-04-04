import api from '../api/api';

export interface TransporterDocumentPayload {
  file_name: string;
  content_base64: string;
}

export type TransporterDocumentType = 'dni' | 'seguro' | 'cedula_verde';

export interface TransporterDocument {
  id: TransporterDocumentType;
  document_type: TransporterDocumentType;
  url: string;
  file_path: string | null;
  file_name: string;
  uploaded_at: string | null;
  expiration_date: string | null;
  content_type: string | null;
}

export type TransporterDocumentStatus = 'completo' | 'incompleto' | 'vencido' | 'por_vencer';

export interface Transporter {
  id: number;
  name: string;
  zone: string | null;
  phone: string | null;
  domicilio: string | null;
  dni_file_path: string | null;
  dni_file_name: string | null;
  dni_uploaded_at: string | null;
  dni_file_url: string | null;
  seguro_file_path: string | null;
  seguro_file_name: string | null;
  seguro_uploaded_at: string | null;
  seguro_file_url: string | null;
  cedula_verde_file_path: string | null;
  cedula_verde_file_name: string | null;
  cedula_verde_uploaded_at: string | null;
  cedula_verde_file_url: string | null;
  insurance_expiration_date: string | null;
  license_expiration_date: string | null;
  document_status: TransporterDocumentStatus;
  missing_documents: string[];
  expiring_documents: string[];
  active: boolean;
  created_at: string;
}

export interface TransporterCreatePayload {
  name: string;
  zone?: string | null;
  phone?: string | null;
  domicilio?: string | null;
  dni_file?: TransporterDocumentPayload | null;
  seguro_file?: TransporterDocumentPayload | null;
  cedula_verde_file?: TransporterDocumentPayload | null;
  insurance_expiration_date?: string | null;
  license_expiration_date?: string | null;
  active?: boolean;
}

export interface TransporterUpdatePayload {
  name?: string | null;
  zone?: string | null;
  phone?: string | null;
  domicilio?: string | null;
  dni_file?: TransporterDocumentPayload | null;
  seguro_file?: TransporterDocumentPayload | null;
  cedula_verde_file?: TransporterDocumentPayload | null;
  insurance_expiration_date?: string | null;
  license_expiration_date?: string | null;
  active?: boolean;
}

function getHeader(headers: Record<string, string>, key: string): string | null {
  return headers[key] ?? headers[key.toLowerCase()] ?? null;
}

function parseFileName(headers: Record<string, string>, fallback: string): string {
  const disposition = getHeader(headers, 'content-disposition');
  if (!disposition) return fallback;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

function triggerDownload(blob: Blob, fileName: string): void {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export async function fetchTransporters(activeOnly = false): Promise<Transporter[]> {
  const params = activeOnly ? { active_only: true } : {};
  const { data } = await api.get<Transporter[]>('/transporters', { params });
  return data;
}

export async function fetchTransporter(id: number): Promise<Transporter> {
  const { data } = await api.get<Transporter>(`/transporters/${id}`);
  return data;
}

export async function fetchTransporterDocuments(id: number): Promise<TransporterDocument[]> {
  const { data } = await api.get<TransporterDocument[]>(`/transporters/${id}/documents`);
  return data;
}

export async function createTransporter(payload: TransporterCreatePayload): Promise<Transporter> {
  const { data } = await api.post<Transporter>('/transporters', payload);
  return data;
}

export async function updateTransporter(id: number, payload: TransporterUpdatePayload): Promise<Transporter> {
  const { data } = await api.put<Transporter>(`/transporters/${id}`, payload);
  return data;
}

export async function deleteTransporter(id: number): Promise<void> {
  await api.delete(`/transporters/${id}`);
}

export async function downloadTransporterDocument(transporterId: number, documentId: TransporterDocumentType): Promise<void> {
  const response = await api.get<Blob>(`/transporters/${transporterId}/documents/${documentId}/download`, {
    responseType: 'blob',
  });
  const fileName = parseFileName(response.headers as Record<string, string>, `${documentId}.bin`);
  triggerDownload(response.data, fileName);
}
