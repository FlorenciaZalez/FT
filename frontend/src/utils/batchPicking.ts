import type { BatchPickingSessionItem } from '../services/batchPicking';

export const DEFAULT_BATCH_LOCATION = 'DEFAULT';

export function normalizeBatchLocation(locationCode: string | null | undefined): string {
  const value = locationCode?.trim();
  return value || DEFAULT_BATCH_LOCATION;
}

export function compareBatchLocations(left: string | null | undefined, right: string | null | undefined): number {
  const leftValue = normalizeBatchLocation(left);
  const rightValue = normalizeBatchLocation(right);

  if (leftValue === DEFAULT_BATCH_LOCATION && rightValue !== DEFAULT_BATCH_LOCATION) return 1;
  if (rightValue === DEFAULT_BATCH_LOCATION && leftValue !== DEFAULT_BATCH_LOCATION) return -1;

  return leftValue.localeCompare(rightValue, 'es-AR', { numeric: true, sensitivity: 'base' });
}

export function compareBatchItems(left: BatchPickingSessionItem, right: BatchPickingSessionItem): number {
  const byLocation = compareBatchLocations(left.location_codes[0], right.location_codes[0]);
  if (byLocation !== 0) return byLocation;
  return left.sku.localeCompare(right.sku, 'es-AR', { numeric: true, sensitivity: 'base' });
}

export function groupBatchItemsByLocation(items: BatchPickingSessionItem[]) {
  const groups = new Map<string, BatchPickingSessionItem[]>();
  [...items].sort(compareBatchItems).forEach((item) => {
    const location = normalizeBatchLocation(item.location_codes[0]);
    const current = groups.get(location) ?? [];
    current.push(item);
    groups.set(location, current);
  });

  return Array.from(groups.entries()).map(([location, groupedItems]) => ({
    location,
    items: groupedItems,
    totalUnits: groupedItems.reduce((sum, item) => sum + item.quantity_total, 0),
    pickedUnits: groupedItems.reduce((sum, item) => sum + item.quantity_picked, 0),
    completedItems: groupedItems.filter((item) => item.is_complete).length,
  }));
}