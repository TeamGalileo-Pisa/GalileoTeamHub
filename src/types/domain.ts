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
}

export interface RoomAvailability {
  id: string;
  roomId: string;
  roomName: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "cancelled";
  bookedInterviews: number;
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
