import api from '../api/api';

export interface Location {
  id: number;
  code: string;
  zone: string;
  aisle: string;
  shelf: string;
  position: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface LocationCreatePayload {
  zone: string;
  aisle: string;
  shelf: string;
  position: string;
  description?: string;
}

export async function fetchLocations(params?: {
  zone?: string;
  aisle?: string;
  search?: string;
}): Promise<Location[]> {
  const { data } = await api.get<Location[]>('/locations', { params });
  return data;
}

export async function createLocation(payload: LocationCreatePayload): Promise<Location> {
  const { data } = await api.post<Location>('/locations', payload);
  return data;
}

export async function updateLocation(
  id: number,
  payload: { description?: string; is_active?: boolean },
): Promise<Location> {
  const { data } = await api.put<Location>(`/locations/${id}`, payload);
  return data;
}

export async function deleteLocation(id: number): Promise<void> {
  await api.delete(`/locations/${id}`);
}
