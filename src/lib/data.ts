import { supabase } from "./supabase";
import type {
  Announcement,
  AnnouncementInput,
  AreaRecord,
  AllocationOption,
  BookingConfirmation,
  CampaignAreaOption,
  DashboardMetrics,
  InterviewSession,
  PublicBookingAvailability,
  RecruitmentCampaign,
  Room,
  RoomAvailability,
  RoomAvailabilityUsage,
  StaffMember,
  UpcomingInterview,
} from "../types/domain";
import { friendlyError } from "./errors";

type JsonRecord = Record<string, unknown>;

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function throwIfError(error: unknown) {
  if (error) throw friendlyError(error);
}

async function throwIfFunctionError(error: unknown): Promise<void> {
  if (!error) return;

  const context =
    typeof error === "object" && error
      ? (error as { context?: unknown }).context
      : undefined;
  if (context instanceof Response) {
    let payload: unknown;
    try {
      payload = (await context.clone().json()) as unknown;
    } catch {
      payload = undefined;
    }
    if (payload) throw friendlyError(payload);
  }

  throw friendlyError(error);
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { data, error } = await supabase.rpc("get_dashboard_metrics");
  throwIfError(error);
  const row = (data ?? {}) as JsonRecord;

  return {
    interviewsToday: asNumber(row.interviews_today),
    interviewsThisWeek: asNumber(row.interviews_this_week),
    availableSlots: asNumber(row.available_slots),
    bookedSlots: asNumber(row.booked_slots),
    activeAreas: asNumber(row.active_areas),
  };
}

export async function listUpcomingInterviews(): Promise<UpcomingInterview[]> {
  const { data, error } = await supabase.rpc("list_upcoming_interviews", {
    p_limit: 12,
  });
  throwIfError(error);

  return ((data ?? []) as JsonRecord[]).map((row) => ({
    bookingId: asString(row.booking_id),
    candidateName: asString(row.candidate_name),
    candidateEmail: asString(row.candidate_email),
    areaName: asString(row.area_name),
    roomName: asString(row.room_name),
    startsAt: asString(row.starts_at),
    endsAt: asString(row.ends_at),
  }));
}

export async function listRooms(): Promise<Room[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, name, location, active, max_simultaneous_interviews_limit")
    .order("name");
  throwIfError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    location: row.location,
    active: row.active,
    maxSimultaneousInterviewsLimit: row.max_simultaneous_interviews_limit,
  }));
}

export async function createRoom(input: {
  name: string;
  location?: string;
  maxSimultaneousInterviewsLimit?: number | null;
}): Promise<void> {
  const { error } = await supabase.from("rooms").insert({
    name: input.name.trim(),
    location: input.location?.trim() || null,
    max_simultaneous_interviews_limit:
      input.maxSimultaneousInterviewsLimit ?? null,
  });
  throwIfError(error);
}

export async function listRoomAvailabilities(): Promise<RoomAvailability[]> {
  const { data, error } = await supabase.rpc("list_room_availabilities");
  throwIfError(error);

  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: asString(row.id),
    roomId: asString(row.room_id),
    roomName: asString(row.room_name),
    roomPhysicalLimit:
      row.room_physical_limit === null || row.room_physical_limit === undefined
        ? null
        : asNumber(row.room_physical_limit),
    startsAt: asString(row.starts_at),
    endsAt: asString(row.ends_at),
    status:
      row.status === "cancelled" ? ("cancelled" as const) : ("active" as const),
    maxSimultaneousInterviews: asNumber(row.max_simultaneous_interviews),
    simultaneousUsage: asNumber(row.simultaneous_usage),
    areaNote: asString(row.area_note),
    bookedInterviews: asNumber(row.booked_interviews),
  }));
}

export async function createRoomAvailability(input: {
  roomId: string;
  startsAt: string;
  endsAt: string;
  maxSimultaneousInterviews: number;
  areaNote: string;
}): Promise<void> {
  const { error } = await supabase.rpc("create_room_availability", {
    p_room_id: input.roomId,
    p_starts_at: new Date(input.startsAt).toISOString(),
    p_ends_at: new Date(input.endsAt).toISOString(),
    p_max_simultaneous_interviews: input.maxSimultaneousInterviews,
    p_area_note: input.areaNote.trim(),
  });
  throwIfError(error);
}

export async function updateRoomAvailability(input: {
  id: string;
  startsAt: string;
  endsAt: string;
  maxSimultaneousInterviews: number;
  areaNote: string;
}): Promise<void> {
  const { error } = await supabase.rpc("update_room_availability", {
    p_availability_id: input.id,
    p_starts_at: new Date(input.startsAt).toISOString(),
    p_ends_at: new Date(input.endsAt).toISOString(),
    p_max_simultaneous_interviews: input.maxSimultaneousInterviews,
    p_area_note: input.areaNote.trim(),
  });
  throwIfError(error);
}

export async function getRoomAvailabilityIntervalUsage(input: {
  availabilityId: string;
  startsAt: string;
  endsAt: string;
}): Promise<RoomAvailabilityUsage> {
  const { data, error } = await supabase.rpc(
    "get_room_availability_interval_usage",
    {
      p_availability_id: input.availabilityId,
      p_starts_at: new Date(input.startsAt).toISOString(),
      p_ends_at: new Date(input.endsAt).toISOString(),
    },
  );
  throwIfError(error);
  const row = (data ?? {}) as JsonRecord;
  return {
    usage: asNumber(row.usage),
    capacity: asNumber(row.capacity),
    remaining: asNumber(row.remaining),
    complete: asBoolean(row.complete),
  };
}

export async function cancelRoomAvailability(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_room_availability", {
    p_availability_id: id,
  });
  throwIfError(error);
}

export async function listMyCampaignAreas(): Promise<CampaignAreaOption[]> {
  const { data, error } = await supabase.rpc("list_my_campaign_areas");
  throwIfError(error);

  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: asString(row.id),
    campaignName: asString(row.campaign_name),
    areaId: asString(row.area_id),
    areaName: asString(row.area_name),
  }));
}

export async function claimRoomAllocation(input: {
  availabilityId: string;
  campaignAreaId: string;
  startsAt: string;
  endsAt: string;
}): Promise<void> {
  const { error } = await supabase.rpc("claim_room_allocation", {
    p_availability_id: input.availabilityId,
    p_campaign_area_id: input.campaignAreaId,
    p_starts_at: new Date(input.startsAt).toISOString(),
    p_ends_at: new Date(input.endsAt).toISOString(),
  });
  throwIfError(error);
}

export async function listAreas(): Promise<AreaRecord[]> {
  const { data, error } = await supabase
    .from("areas")
    .select("id, name, slug, active, parent_area_id")
    .order("name");
  throwIfError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    parentAreaId: row.parent_area_id,
  }));
}

export async function createArea(input: {
  name: string;
  slug: string;
}): Promise<void> {
  const { error } = await supabase.from("areas").insert({
    name: input.name.trim(),
    slug: input.slug.trim(),
  });
  throwIfError(error);
}

export async function listCampaigns(): Promise<RecruitmentCampaign[]> {
  const { data, error } = await supabase
    .from("recruitment_campaigns")
    .select("id, name, starts_on, ends_on, status")
    .order("created_at", { ascending: false });
  throwIfError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
  }));
}

export async function createCampaign(input: {
  name: string;
  startsOn?: string;
  endsOn?: string;
}): Promise<void> {
  const { error } = await supabase.from("recruitment_campaigns").insert({
    name: input.name.trim(),
    starts_on: input.startsOn || null,
    ends_on: input.endsOn || null,
    status: "draft",
  });
  throwIfError(error);
}

export async function activateCampaign(id: string): Promise<void> {
  const { error } = await supabase.rpc("activate_campaign", {
    p_campaign_id: id,
  });
  throwIfError(error);
}

export async function listStaff(): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("list_staff_members");
  throwIfError(error);

  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: asString(row.id),
    username: asString(row.username),
    displayName: asString(row.display_name),
    status: row.status === "disabled" ? "disabled" : "active",
    isAdmin: asBoolean(row.is_admin),
    areas: Array.isArray(row.areas)
      ? (row.areas as JsonRecord[]).map((area) => ({
          id: asString(area.id),
          name: asString(area.name),
          slug: asString(area.slug),
        }))
      : [],
  }));
}

export async function createStaffMember(input: {
  username: string;
  displayName: string;
  temporaryPassword: string;
  isAdmin: boolean;
  areaId?: string;
}): Promise<void> {
  const { error } = await supabase.functions.invoke("staff-admin", {
    body: input,
  });
  await throwIfFunctionError(error);
}

export async function completePasswordChange(): Promise<void> {
  const { error } = await supabase.rpc("complete_password_change");
  throwIfError(error);
}

export async function listInterviewSessions(): Promise<InterviewSession[]> {
  const { data, error } = await supabase.rpc("list_interview_sessions");
  throwIfError(error);

  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    areaName: asString(row.area_name),
    roomName: asString(row.room_name),
    startsAt: asString(row.starts_at),
    endsAt: asString(row.ends_at),
    status:
      row.status === "published" ||
      row.status === "closed" ||
      row.status === "cancelled"
        ? row.status
        : "draft",
    availableSlots: asNumber(row.available_slots),
    bookedSlots: asNumber(row.booked_slots),
    bookingLinkActive: asBoolean(row.booking_link_active),
  }));
}

export async function listMyAllocations(): Promise<AllocationOption[]> {
  const { data, error } = await supabase.rpc("list_my_allocations");
  throwIfError(error);

  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: asString(row.id),
    campaignAreaId: asString(row.campaign_area_id),
    areaName: asString(row.area_name),
    roomName: asString(row.room_name),
    startsAt: asString(row.starts_at),
    endsAt: asString(row.ends_at),
  }));
}

export async function createInterviewSession(input: {
  allocationId: string;
  name: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_interview_session", {
    p_allocation_id: input.allocationId,
    p_name: input.name.trim(),
  });
  throwIfError(error);
  return asString(data);
}

export async function generateSessionSlots(
  sessionId: string,
  durationMinutes: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("generate_session_slots", {
    p_session_id: sessionId,
    p_duration_minutes: durationMinutes,
  });
  throwIfError(error);
  return asNumber(data);
}

export async function rotateBookingLink(sessionId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rotate_booking_link", {
    p_session_id: sessionId,
  });
  throwIfError(error);
  return asString(data);
}

export async function getPublicBookingAvailability(
  token: string,
): Promise<PublicBookingAvailability> {
  const { data, error } = await supabase.functions.invoke("public-booking", {
    body: { action: "availability", token },
  });
  await throwIfFunctionError(error);
  return data as PublicBookingAvailability;
}

export async function createPublicBooking(input: {
  token: string;
  slotId: string;
  firstName: string;
  lastName: string;
  email: string;
}): Promise<BookingConfirmation> {
  const { data, error } = await supabase.functions.invoke("public-booking", {
    body: {
      action: "book",
      token: input.token,
      slotId: input.slotId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
    },
  });
  await throwIfFunctionError(error);
  return data as BookingConfirmation;
}

export async function listAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase.rpc("list_announcements");
  throwIfError(error);

  return ((data ?? []) as JsonRecord[]).map((row) => ({
    id: asString(row.id),
    title: asString(row.title),
    body: asString(row.body),
    allAreas: asBoolean(row.all_areas),
    targetAreaIds: Array.isArray(row.target_area_ids)
      ? row.target_area_ids.map(asString)
      : [],
    targetAreaNames: Array.isArray(row.target_area_names)
      ? row.target_area_names.map(asString)
      : [],
    publishedAt: asString(row.published_at),
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    important: asBoolean(row.important),
    pinned: asBoolean(row.pinned),
    isActive: asBoolean(row.is_active),
    isRead: asBoolean(row.is_read),
    readCount: asNumber(row.read_count),
    createdAt: asString(row.created_at),
  }));
}

function announcementRpcInput(input: AnnouncementInput) {
  return {
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_all_areas: input.allAreas,
    p_target_area_ids: input.allAreas ? [] : input.targetAreaIds,
    p_published_at: new Date(input.publishedAt).toISOString(),
    p_expires_at: input.expiresAt
      ? new Date(input.expiresAt).toISOString()
      : null,
    p_important: input.important,
    p_pinned: input.pinned,
  };
}

export async function createAnnouncement(input: AnnouncementInput): Promise<void> {
  const { error } = await supabase.rpc(
    "create_announcement",
    announcementRpcInput(input),
  );
  throwIfError(error);
}

export async function updateAnnouncement(
  input: AnnouncementInput & { id: string },
): Promise<void> {
  const { error } = await supabase.rpc("update_announcement", {
    p_announcement_id: input.id,
    ...announcementRpcInput(input),
  });
  throwIfError(error);
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_announcement", {
    p_announcement_id: id,
  });
  throwIfError(error);
}

export async function markAnnouncementRead(
  id: string,
  read = true,
): Promise<void> {
  const { error } = await supabase.rpc("mark_announcement_read", {
    p_announcement_id: id,
    p_read: read,
  });
  throwIfError(error);
}

export async function getUnreadAnnouncementCount(): Promise<number> {
  const { data, error } = await supabase.rpc("get_unread_announcement_count");
  throwIfError(error);
  return asNumber(data);
}

export async function sendAdminTestEmail(toEmail: string): Promise<void> {
  const { error } = await supabase.functions.invoke("admin-email-test", {
    body: { toEmail: toEmail.trim() },
  });
  await throwIfFunctionError(error);
}
