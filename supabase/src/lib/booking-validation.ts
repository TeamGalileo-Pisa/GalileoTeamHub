import { z } from "zod";
import {
  STUDENT_EMAIL_MESSAGE,
  STUDENT_EMAIL_PATTERN,
} from "../../supabase/functions/_shared/booking-validation";

export const bookingSchema = z.object({
  slotId: z.string().uuid("Seleziona prima uno degli orari disponibili."),
  firstName: z
    .string()
    .trim()
    .min(2, "Inserisci il nome.")
    .max(80, "Usa al massimo 80 caratteri."),
  lastName: z
    .string()
    .trim()
    .min(2, "Inserisci il cognome.")
    .max(80, "Usa al massimo 80 caratteri."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Inserisci il tuo indirizzo email universitario.")
    .max(254)
    .regex(STUDENT_EMAIL_PATTERN, STUDENT_EMAIL_MESSAGE),
});
