import { supabase } from './supabase';

// ==========================================
// INTERFACCE E TIPI COMPATIBILI
// ==========================================

export interface AreaRecord {
  id: string;
  name: string;
  description?: string;
  slug?: string;
  active: boolean;
  parentAreaId?: string | null;
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
  name: string;
  title?: string;
  session_date: string;
  start_time: string;
  end_time: string;
  startsAt: string;
  endsAt: string;
  area_name: string;
  areaName: string;
  bookingId?: string;
  candidateName?: string;
  candidateEmail?: string;
  roomName: string;
  bookingLinkActive: boolean;
  booked_count: number;
  bookedSlots: number;
  max_capacity: number;
  availableSlots: number;
  status: string;
}

export type InterviewSession = InterviewRecord;

export interface StaffMemberRecord {
  id: string;
  first_name: string;
  last_name: string;
  displayName: string;
  username: string;
  email: string;
  role: string;
  isAdmin: boolean;
  status: string;
  areas: AreaRecord[];
  area_ids?: string[];
  created_at?: string;
}

export type StaffMember = StaffMemberRecord;

export interface CampaignRecord {
  id: string;
  name: string;
  starts_on?: string;
  startsOn: string | null;
  ends_on?: string;
  endsOn: string | null;
  is_active: boolean;
  status: string;
  created_at?: string;
}

export type RecruitmentCampaign = CampaignRecord;

export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  created_at: string;
  is_read: boolean;
}

export interface RoomRecord {
  id: string;
  name: string;
  capacity: number;
  description?: string;
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
  return (data || []).map((area: any) => ({
    ...area,
    active: area.active ?? true,
    parentAreaId: area.parent_area_id || null,
  }));
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
    .select('id, session_date, start_time, end_time, room_name, max_capacity, areas(name)')
    .gte('session_date', new Date().toISOString().split('T')[0])
    .order('session_date', { ascending: true })
    .limit(10);

  if (error) return [];
  return (data || []).map((s: any) => {
    const areaName = s.areas?.name || 'Generale';
    const sessionDate = s.session_date || new Date().toISOString().split('T')[0];
    const startTime = s.start_time || '09:00:00';
    const endTime = s.end_time || '10:00:00';
    const startsAt = `${sessionDate}T${startTime}`;
    const endsAt = `${sessionDate}T${endTime}`;

    return {
      id: s.id,
      name: `Colloquio ${areaName}`,
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      startsAt,
      endsAt,
      area_name: areaName,
      areaName,
      roomName: s.room_name || 'Aula Standard',
      bookingId: s.id,
      candidateName: 'Candidato',
      candidateEmail: '',
      booked_count: 0,
      bookedSlots: 0,
      max_capacity: s.max_capacity || 1,
      availableSlots: s.max_capacity || 1,
      bookingLinkActive: true,
      status: 'scheduled',
    };
  });
}

// ==========================================
// SESSIONI E ASSEGNAZIONI
// ==========================================

export async function listInterviewSessions(): Promise<InterviewRecord[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, areas(name)')
    .order('session_date', { ascending: true });

  if (error) return [];
  return (data || []).map((s: any) => {
    const areaName = s.areas?.name || 'Generale';
    const sessionDate = s.session_date || new Date().toISOString().split('T')[0];
    const startTime = s.start_time || '09:00:00';
    const endTime = s.end_time || '10:00:00';
    const startsAt = `${sessionDate}T${startTime}`;
    const endsAt = `${sessionDate}T${endTime}`;

    return {
      id: s.id,
      name: s.name || `Sessione ${areaName}`,
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      startsAt,
      endsAt,
      area_name: areaName,
      areaName,
      roomName: s.room_name || 'Aula 1',
      booked_count: s.booked_count || 0,
      bookedSlots: s.booked_count || 0,
      max_capacity: s.max_capacity || 1,
      availableSlots: (s.max_capacity || 1) - (s.booked_count || 0),
      bookingLinkActive: s.is_active ?? true,
      status: s.status || 'active',
    };
  });
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
  return (data || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    starts_on: c.starts_on,
    startsOn: c.starts_on || c.startsOn || null,
    ends_on: c.ends_on,
    endsOn: c.ends_on || c.endsOn || null,
    is_active: c.is_active ?? false,
    status: c.is_active ? 'active' : 'draft',
    created_at: c.created_at,
  }));
}

export async function createCampaign(campaign: { name: string; startsOn?: string; endsOn?: string; [key: string]: any }): Promise<void> {
  const { error } = await supabase.from('campaigns').insert({
    name: campaign.name,
    starts_on: campaign.startsOn || campaign.starts_on,
    ends_on: campaign.endsOn || campaign.ends_on,
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

export async function listMyCampaignAreas(): Promise<any[]> {
  const { data, error } = await supabase.from('areas').select('*');
  if (error) return [];
  return data || [];
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
  return (data || []).map((s: any) => ({
    id: s.id,
    first_name: s.first_name || '',
    last_name: s.last_name || '',
    displayName: `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email || 'Staff',
    username: s.email ? s.email.split('@')[0] : 'user',
    email: s.email || '',
    role: s.role || 'staff',
    isAdmin: s.role === 'admin',
    status: 'active',
    areas: [],
    created_at: s.created_at,
  }));
}

export async function createStaffMember(member: {
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  area_ids?: string[];
  [key: string]: any;
}): Promise<void> {
  const { error } = await supabase.from('staff').insert({
    first_name: member.first_name || member.displayName || '',
    last_name: member.last_name || '',
    email: member.email || `${member.username || 'user'}@galileo.it`,
    role: member.role || (member.isAdmin ? 'admin' : 'staff'),
    area_ids: member.area_ids || [],
  });
  if (error) throw error;
}

// ==========================================
// ANNUNCI (ANNOUNCEMENTS)
// ==========================================

export async function listAnnouncements(): Promise<AnnouncementRecord[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

export async function createAnnouncement(announcement: { title: string; content: string }): Promise<void> {
  const { error } = await supabase.from('announcements').insert(announcement);
  if (error) throw error;
}

export async function updateAnnouncement(id: string, updates: Partial<AnnouncementRecord>): Promise<void> {
  const { error } = await supabase.from('announcements').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) throw error;
}

export async function markAnnouncementRead(id: string): Promise<void> {
  const { error } = await supabase.from('announcements').update({ is_read: true }).eq('id', id);
  if (error) throw error;
}

// ==========================================
// SALE E DISPONIBILITÀ (AULE)
// ==========================================

export async function listRooms(): Promise<RoomRecord[]> {
  const { data, error } = await supabase.from('rooms').select('*').order('name');
  if (error) return [];
  return data || [];
}

export async function createRoom(room: { name: string; capacity?: number }): Promise<void> {
  const { error } = await supabase.from('rooms').insert(room);
  if (error) throw error;
}

export async function listRoomAvailabilities(): Promise<any[]> {
  const { data, error } = await supabase.from('room_availabilities').select('*');
  if (error) return [];
  return data || [];
}

export async function updateRoomAvailability(id: string, data: any): Promise<void> {
  const { error } = await supabase.from('room_availabilities').update(data).eq('id', id);
  if (error) throw error;
}

export async function cancelRoomAvailability(id: string): Promise<void> {
  const { error } = await supabase.from('room_availabilities').delete().eq('id', id);
  if (error) throw error;
}

export async function claimRoomAllocation(data: any): Promise<void> {
  const { error } = await supabase.from('allocations').insert(data);
  if (error) throw error;
}

export async function getRoomAvailabilityIntervalUsage(id: string): Promise<any[]> {
  return [];
}

// ==========================================
// ACCOUNT E UTILITY
// ==========================================

export async function completePasswordChange(newPassword?: string): Promise<void> {
  if (!newPassword) return;
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function sendAdminTestEmail(email: string): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-email-test', {
    body: { email },
  });
  if (error) throw error;
}