import { supabase } from './supabase';

export interface AreaSlot {
  slot_id: string;
  area_id: string;
  area_name: string;
  area_description?: string;
  session_date: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  booked_count: number;
  available_capacity: number;
}

export interface AreaInfo {
  id: string;
  name: string;
  description?: string;
  slug: string;
}

/**
 * Recupera le informazioni dell'Area tramite il suo slug unico.
 */
export async function getAreaBySlug(slug: string): Promise<AreaInfo | null> {
  const { data, error } = await supabase
    .from('areas')
    .select('id, name, description, slug')
    .eq('slug', slug)
    .single();

  if (error) {
    console.error('Errore nel recupero dell\'area:', error);
    return null;
  }
  return data;
}

/**
 * Recupera l'elenco unico degli slot disponibili per l'Area indicata dallo slug.
 */
export async function getAreaPublicCalendar(
  areaSlug: string,
  startDate?: string,
  endDate?: string
): Promise<AreaSlot[]> {
  const { data, error } = await supabase.rpc('get_area_public_calendar', {
    p_area_slug: areaSlug,
    p_start_date: startDate || new Date().toISOString().split('T')[0],
    p_end_date: endDate || undefined,
  });

  if (error) {
    console.error('Errore durante il caricamento del calendario d\'area:', error);
    return [];
  }

  return data || [];
}