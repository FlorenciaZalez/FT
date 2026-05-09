import api from '../api/api';

export interface OrderReportRow {
  order_id: number;
  created_at: string;
  product_name: string;
  customer_name: string | null;
  shipping_address: string | null;
  zip_code: string | null;
  city: string | null;
  province: string | null;
  status: string;
  carrier: string | null;
  cordon: string;
}

export interface OrderReportFilters {
  fromDate: string;
  toDate: string;
}

function getHeader(headers: Record<string, string>, key: string): string | null {
  const direct = headers[key];
  if (direct) return direct;
  return headers[key.toLowerCase()] ?? null;
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

function toDateRangeParams(filters: OrderReportFilters): { from_date: string; to_date: string } {
  return {
    from_date: new Date(`${filters.fromDate}T00:00:00`).toISOString(),
    to_date: new Date(`${filters.toDate}T23:59:59.999`).toISOString(),
  };
}

export async function fetchOrdersReport(filters: OrderReportFilters): Promise<OrderReportRow[]> {
  const { data } = await api.get<OrderReportRow[]>('/reports/orders', {
    params: toDateRangeParams(filters),
  });
  return data;
}

export async function downloadOrdersReportCsv(filters: OrderReportFilters): Promise<void> {
  let response;
  try {
    response = await api.get<Blob>('/reports/orders', {
      params: {
        ...toDateRangeParams(filters),
        format: 'csv',
      },
      responseType: 'blob',
    });
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: unknown } };
    if (axiosErr.response?.data instanceof Blob) {
      try {
        const text = await axiosErr.response.data.text();
        axiosErr.response.data = JSON.parse(text);
      } catch {
        // ignore parse errors and rethrow
      }
    }
    throw err;
  }

  const fileName = parseFileName(response.headers as Record<string, string>, 'reporte-pedidos.csv');
  triggerDownload(response.data, fileName);
}