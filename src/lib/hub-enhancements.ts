import type { BookingConfirmation } from "../types/domain";
import { friendlyError } from "./errors";
import { supabase } from "./supabase";

export interface LegalDocument {
  key: "privacy" | "terms";
  title: string;
  body: string;
  version: number;
  updatedAt: string;
}

export interface OnlineAreaLead {
  userId: string;
  username: string;
  displayName: string;
  areas: Array<{ id: string; name: string; slug: string }>;
  lastSeenAt: string;
  lastPath: string | null;
}

export interface CandidateRating {
  id: string;
  areaId: string;
  areaName: string;
  firstName: string;
  lastName: string;
  email: string;
  courseOfStudy: string;
  interviewDate: string;
  score: number;
  comment: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw friendlyError(error);
  return data as T;
}

export function getPublicPrivacyDocument(): Promise<LegalDocument> {
  return rpc<LegalDocument>("get_public_privacy_document");
}

export function listLegalDocuments(): Promise<LegalDocument[]> {
  return rpc<LegalDocument[]>("list_legal_documents");
}

export function updateLegalDocument(input: {
  key: "privacy" | "terms";
  title: string;
  body: string;
}): Promise<LegalDocument> {
  return rpc<LegalDocument>("update_legal_document", {
    p_key: input.key,
    p_title: input.title,
    p_body: input.body,
  });
}

export function listOnlineAreaLeads(): Promise<OnlineAreaLead[]> {
  return rpc<OnlineAreaLead[]>("list_online_area_leads");
}

export async function createPublicBookingWithPrivacy(input: {
  token: string;
  slotId: string;
  firstName: string;
  lastName: string;
  email: string;
  privacyAccepted: true;
  privacyVersion: number;
}): Promise<BookingConfirmation> {
  const { data, error } = await supabase.functions.invoke("public-booking", {
    body: {
      action: "book",
      token: input.token,
      slotId: input.slotId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      privacyAccepted: input.privacyAccepted,
      privacyVersion: input.privacyVersion,
    },
  });
  if (error) throw friendlyError(error);
  if (data && typeof data === "object" && "error" in data) throw friendlyError(data);
  return data as BookingConfirmation;
}

export function deleteBookingPermanently(bookingId: string): Promise<void> {
  return rpc<void>("delete_booking_permanently", { p_booking_id: bookingId });
}

export function cancelSession(sessionId: string): Promise<void> {
  return rpc<void>("cancel_session", { p_session_id: sessionId });
}

export function deleteSessionPermanently(sessionId: string): Promise<void> {
  return rpc<void>("delete_session_permanently", { p_session_id: sessionId });
}

export function deleteRoomAvailabilityPermanently(availabilityId: string): Promise<void> {
  return rpc<void>("delete_room_availability_permanently", {
    p_availability_id: availabilityId,
  });
}

export function deleteAreaAllocationPermanently(allocationId: string): Promise<void> {
  return rpc<void>("delete_area_allocation_permanently", {
    p_allocation_id: allocationId,
  });
}

export function deleteSlotPermanently(slotId: string): Promise<void> {
  return rpc<void>("delete_slot_permanently", { p_slot_id: slotId });
}

export function archiveCampaign(campaignId: string, remove = false): Promise<void> {
  return rpc<void>("archive_campaign", {
    p_campaign_id: campaignId,
    p_delete: remove,
  });
}

export function claimRoomAllocationsBatch(input: {
  campaignAreaId: string;
  ranges: Array<{ availabilityId: string; startsAt: string; endsAt: string }>;
}): Promise<{ count: number; ids: string[] }> {
  return rpc<{ count: number; ids: string[] }>("claim_room_allocations_batch", {
    p_campaign_area_id: input.campaignAreaId,
    p_ranges: input.ranges,
  });
}

export function sendBookingReminder(bookingId: string, message: string): Promise<string> {
  return rpc<string>("send_booking_reminder", {
    p_booking_id: bookingId,
    p_message: message,
  });
}

export function listCandidateRatings(): Promise<CandidateRating[]> {
  return rpc<CandidateRating[]>("list_candidate_ratings");
}

export function createCandidateRating(input: Omit<CandidateRating, "id" | "areaName" | "archivedAt" | "createdAt" | "updatedAt">): Promise<string> {
  return rpc<string>("create_candidate_rating", {
    p_area_id: input.areaId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_email: input.email,
    p_course_of_study: input.courseOfStudy,
    p_interview_date: input.interviewDate,
    p_score: input.score,
    p_comment: input.comment || null,
  });
}

export function updateCandidateRating(input: Omit<CandidateRating, "areaName" | "archivedAt" | "createdAt" | "updatedAt">): Promise<void> {
  return rpc<void>("update_candidate_rating", {
    p_id: input.id,
    p_area_id: input.areaId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_email: input.email,
    p_course_of_study: input.courseOfStudy,
    p_interview_date: input.interviewDate,
    p_score: input.score,
    p_comment: input.comment || null,
  });
}

export function archiveCandidateRating(id: string): Promise<void> {
  return rpc<void>("archive_candidate_rating", { p_id: id });
}

export function deleteCandidateRating(id: string): Promise<void> {
  return rpc<void>("delete_candidate_rating", { p_id: id });
}

export function resetCandidateRatings(areaId: string): Promise<void> {
  return rpc<void>("reset_candidate_ratings", { p_area_id: areaId });
}

export function resetAllCandidateRatings(): Promise<void> {
  return rpc<void>("reset_all_candidate_ratings");
}
