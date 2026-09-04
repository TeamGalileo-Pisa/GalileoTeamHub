export type AppRole = "admin" | "area_lead";

export interface AreaSummary {
  id: string;
  name: string;
  slug: string;
}

export interface AccessContext {
  userId: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  areas: AreaSummary[];
}

export interface DashboardMetrics {
  interviewsToday: number;
  interviewsThisWeek: number;
  availableSlots: number;
  bookedSlots: number;
  activeAreas: number;
}

export interface UpcomingInterview {
  bookingId: string;
  candidateName: string;
  candidateEmail: string;
  areaName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
}

export interface Room {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
  maxSimultaneousInterviewsLimit: number | null;
}

export interface RoomAvailability {
  seriesId: string | null;
  id: string;
  roomId: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "cancelled";
  roomPhysicalLimit: number | null;
  maxSimultaneousInterviews: number;
  simultaneousUsage: number;
  areaNote: string;
  bookedInterviews: number;
}

export interface RoomAvailabilityUsage {
  usage: number;
  capacity: number;
  remaining: number;
  complete: boolean;
}

export interface RecruitmentCampaign {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "draft" | "active" | "archived";
}

export interface AreaRecord extends AreaSummary {
  active: boolean;
  parentAreaId: string | null;
}

export interface StaffMember {
  id: string;
  username: string;
  displayName: string;
  status: "active" | "disabled";
  isAdmin: boolean;
  areas: AreaSummary[];
}

export interface InterviewSession {
  id: string;
  areaId: string;
  name: string;
  areaName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "published" | "closed" | "cancelled";
  availableSlots: number;
  bookedSlots: number;
  bookingLinkActive: boolean;
}

export interface CampaignAreaOption {
  id: string;
  campaignName: string;
  areaId: string;
  areaName: string;
}

export interface AllocationOption {
  id: string;
  campaignAreaId: string;
  areaName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
}

export interface PublicBookingSlot {
  id: string;
  startsAt: string;
  endsAt: string;
  roomName: string;
}

export interface PublicBookingAvailability {
  areaName: string;
  sessionName: string;
  slots: PublicBookingSlot[];
}

export interface BookingConfirmation {
  bookingId: string;
  candidateName: string;
  areaName: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  allAreas: boolean;
  targetAreaIds: string[];
  targetAreaNames: string[];
  publishedAt: string;
  expiresAt: string | null;
  important: boolean;
  pinned: boolean;
  isActive: boolean;
  isRead: boolean;
  readCount: number;
  createdAt: string;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  allAreas: boolean;
  targetAreaIds: string[];
  publishedAt: string;
  expiresAt?: string;
  important: boolean;
  pinned: boolean;
}
