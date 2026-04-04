export function toFiniteNumber(value: unknown, fallback = 0): number {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

export function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getDefaultDueDate(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month, 0).toISOString().slice(0, 10);
}

export function formatCurrency(value: number): string {
  const safeValue = toFiniteNumber(value);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(safeValue);
}

export function formatNumber(value: number, digits = 2): string {
  const safeValue = toFiniteNumber(value);
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(safeValue);
}

export function getChargeStatusLabel(status: 'pending' | 'paid' | 'cancelled' | 'overdue'): string {
  if (status === 'paid') return 'Cobrado';
  if (status === 'overdue') return 'Vencido';
  if (status === 'cancelled') return 'Cancelado';
  return 'Pendiente';
}

export function getChargeStatusClasses(status: 'pending' | 'paid' | 'cancelled' | 'overdue'): string {
  if (status === 'paid') return 'bg-green-100 text-green-700';
  if (status === 'overdue') return 'bg-red-100 text-red-700';
  if (status === 'cancelled') return 'bg-red-100 text-red-700';
  return 'bg-yellow-100 text-yellow-800';
}