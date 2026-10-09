import { createServerFn } from "@tanstack/react-start";
import { ANY_BARBER_SLUG, BookingRejected } from "@/lib/agenda/booking-error";

type DaysInput = { barberSlug: string };
type SlotsInput = { serviceSlug: string; barberSlug: string; date: string };
type ConfirmBody = {
  serviceSlug: string;
  barberSlug: string;
  date: string;
  time: string;
  name: string;
  phone: string;
};

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function daysInput(input: unknown): DaysInput {
  const slug = text(asRecord(input).barberSlug);
  return { barberSlug: slug || ANY_BARBER_SLUG };
}

function slotsInput(input: unknown): SlotsInput {
  const record = asRecord(input);
  return {
    serviceSlug: text(record.serviceSlug),
    barberSlug: text(record.barberSlug) || ANY_BARBER_SLUG,
    date: text(record.date),
  };
}

function confirmInput(input: unknown): ConfirmBody {
  const record = asRecord(input);
  return {
    serviceSlug: text(record.serviceSlug),
    barberSlug: text(record.barberSlug) || ANY_BARBER_SLUG,
    date: text(record.date),
    time: text(record.time),
    name: text(record.name),
    phone: text(record.phone),
  };
}

function failure(err: unknown): { ok: false; code: string; message: string } {
  if (err instanceof BookingRejected) {
    return { ok: false, code: err.code, message: err.message };
  }
  return {
    ok: false,
    code: "unavailable",
    message: "Não foi possível concluir o agendamento. Tente de novo.",
  };
}

export const fetchBookingDays = createServerFn({ method: "POST" })
  .validator(daysInput)
  .handler(async ({ data }) => {
    const { listBookingDays } = await import("@/lib/agenda/booking.server");
    try {
      const days = await listBookingDays(data);
      return { ok: true as const, days };
    } catch (err) {
      return failure(err);
    }
  });

export const fetchFreeSlots = createServerFn({ method: "POST" })
  .validator(slotsInput)
  .handler(async ({ data }) => {
    const { listFreeSlots } = await import("@/lib/agenda/booking.server");
    try {
      const times = await listFreeSlots(data);
      return { ok: true as const, times };
    } catch (err) {
      return failure(err);
    }
  });

export const submitBooking = createServerFn({ method: "POST" })
  .validator(confirmInput)
  .handler(async ({ data }) => {
    const { confirmBooking } = await import("@/lib/agenda/booking.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    let ip = "unknown";
    try {
      const request = getRequest();
      const forwarded = request.headers.get("x-forwarded-for");
      ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    } catch {
      ip = "unknown";
    }
    try {
      const result = await confirmBooking(data, ip);
      return { ok: true as const, result };
    } catch (err) {
      return failure(err);
    }
  });
