import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { Brand } from "../components/Brand";
import { appConfig } from "../lib/config";
import { formatBookingDay, formatTimeRange, groupByDay } from "../lib/dates";
import { getPublicBookingAvailability } from "../lib/data";
import {
  createPublicBookingWithPrivacy,
  getPublicPrivacyDocument,
} from "../lib/hub-enhancements";
import type { BookingConfirmation } from "../types/domain";
import { bookingSchema } from "../lib/booking-validation";

const schema = bookingSchema.extend({
  privacyAccepted: z
    .boolean()
    .refine((value) => value, "Devi leggere e accettare l'informativa privacy."),
});

export function PublicBookingPage() {
  const { token = "" } = useParams();
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const availabilityQuery = useQuery({
    queryKey: ["public-booking", token],
    queryFn: () => getPublicBookingAvailability(token),
    enabled: Boolean(token && appConfig.hasSupabaseConfiguration),
    retry: false,
  });
  const privacyQuery = useQuery({
    queryKey: ["public-privacy-document"],
    queryFn: getPublicPrivacyDocument,
    enabled: appConfig.hasSupabaseConfiguration,
    retry: false,
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      slotId: "",
      firstName: "",
      lastName: "",
      email: "",
      privacyAccepted: false,
    },
  });
  const selectedSlotId = useWatch({ control: form.control, name: "slotId" });
  const bookingMutation = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => {
      if (!selectedSlotId) throw new Error("Seleziona prima uno slot");
      if (!privacyQuery.data) throw new Error("Informativa privacy non disponibile. Riprova tra poco.");
      return createPublicBookingWithPrivacy({
        token,
        slotId: values.slotId,
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        privacyAccepted: true,
        privacyVersion: privacyQuery.data.version,
      });
    },
    onSuccess: (result) => setConfirmation(result),
  });
  const slots = useMemo(
    () => availabilityQuery.data?.slots ?? [],
    [availabilityQuery.data?.slots],
  );
