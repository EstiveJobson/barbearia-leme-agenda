export const ANY_BARBER_SLUG = "any";

export class BookingRejected extends Error {
  constructor(
    readonly code: "slot_taken" | "rate_limited" | "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "BookingRejected";
  }
}
