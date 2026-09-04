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
