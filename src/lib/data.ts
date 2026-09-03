import { supabase } from './supabase';

// ==========================================
// INTERFACCE E TIPI
// ==========================================

export interface AreaRecord {
  id: string;
  name: string;
  description?: string;
  slug?: string;
  created_at?: string;
}

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

export interface DashboardMetrics {
  interviewsToday: number;
  interviewsThisWeek: number;
  availableSlots: number;
  bookedSlots: number;
  activeAreas: number;
}

export interface InterviewRecord {
  id: string;
  title?: string;
  session_date: string;
  start_time: string;
  end_time: string;
  area_name?: string;
  booked_count?: number;
  max_capacity?: number;
}

export interface StaffMemberRecord {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  area_ids?: string[];
  created_at?: string;
}

export interface CampaignRecord {
  id: string;
  name: string;
  starts_on?: string;
  ends_on?: string;
  is_active: boolean;
  created_at?: string;
}

// ==========================================
// AREE E CALENDARI
// ==========================================

export async function listAreas(): Promise<AreaRecord[]> {
  const { data, error } = await supabase
    .from('areas')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Errore nel recupero delle aree:', error);
    return [];
  }
  return data || [];
}

export async function getAreaBySlug(slug: string): Promise<AreaInfo | null> {
  const { data, error } = await supabase
    .from('areas')
    .select('id, name, description, slug')
    .eq('slug', slug)
    .single();

  if (error) {
    console.error('Errore nel recupero dell\'area tramite slug:', error);
    return null;
  }
  return data;
}

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
    console.error('Errore nel caricamento del calendario d\'area:', error);
    return [];
  }
  return data || [];
}

// ==========================================
// DASHBOARD E METRICHE
// ==========================================

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { data, error } = await supabase.rpc('get_dashboard_metrics');
  if (error || !data) {
    return {
      interviewsToday: 0,
      interviewsThisWeek: 0,
      availableSlots: 0,
      bookedSlots: 0,
      activeAreas: 0,
    };
  }
  return data;
}

export async function getUnreadAnnouncementCount(): Promise<number> {
  const { count, error } = await supabase
    .from('announcements')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) return 0;
  return count || 0;
}

export async function listUpcomingInterviews(): Promise<InterviewRecord[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, session_date, start_time, end_time, areas(name)')
    .gte('session_date', new Date().toISOString().split('T')[0])
    .order('session_date', { ascending: true })
    .limit(10);

  if (error) return [];
  return (data || []).map((s: any) => ({
    id: s.id,
    session_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    area_name: s.areas?.name || 'Generale',
  }));
}

// ==========================================
// SESSIONI E ASSEGNAZIONI
// ==========================================

export async function listInterviewSessions(): Promise<InterviewRecord[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('session_date', { ascending: true });

  if (error) return [];
  return data || [];
}

export async function listMyAllocations(): Promise<any[]> {
  const { data, error } = await supabase.from('allocations').select('*');
  if (error) return [];
  return data || [];
}

export async function rotateBookingLink(sessionId?: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_booking_link', {
    p_session_id: sessionId,
  });
  if (error) return '';
  return data || '';
}

// ==========================================
// CAMPAGNE
// ==========================================

export async function listCampaigns(): Promise<CampaignRecord[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

export async function createCampaign(campaign: { name: string; startsOn?: string; endsOn?: string }): Promise<void> {
  const { error } = await supabase.from('campaigns').insert({
    name: campaign.name,
    starts_on: campaign.startsOn,
    ends_on: campaign.endsOn,
    is_active: false,
  });
  if (error) throw error;
}

export async function activateCampaign(id: string): Promise<void> {
  const { error } = await supabase
    .from('campaigns')
    .update({ is_active: true })
    .eq('id', id);

  if (error) throw error;
}

// ==========================================
// STAFF
// ==========================================

export async function listStaff(): Promise<StaffMemberRecord[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('last_name', { ascending: true });

  if (error) return [];
  return data || [];
}

export async function createStaffMember(member: {
  first_name: string;
  last_name: string;
  email: string;
  role?: string;
  area_ids?: string[];
}): Promise<void> {
  const { error } = await supabase.from('staff').insert(member);
  if (error) throw error;
}

// ==========================================
// ACCOUNT E UTILITY
// ==========================================

export async function completePasswordChange(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function sendAdminTestEmail(email: string): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-email-test', {
    body: { email },
  });
  if (error) throw error;
}