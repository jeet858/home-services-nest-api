// Booking lifecycle groupings shared by the customer, partner and admin APIs.

export const ALL_STATUSES = [
  'pending',
  'confirmed',
  'searching',
  'offered',
  'accepted',
  'on_the_way',
  'arrived',
  'inspecting',
  'quote_sent',
  'payment_pending',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type BookingStatusValue = (typeof ALL_STATUSES)[number];

/** Still looking for a professional. */
export const UNASSIGNED: BookingStatusValue[] = ['pending', 'searching', 'offered'];

/** A professional owns the job and it is not finished. `confirmed` is the legacy "started" value. */
export const ACTIVE_WITH_PRO: BookingStatusValue[] = [
  'confirmed',
  'accepted',
  'on_the_way',
  'arrived',
  'inspecting',
  'quote_sent',
  'payment_pending',
  'in_progress',
];

/** Partner "Ongoing" tab: the professional has left for the job. */
export const ONGOING: BookingStatusValue[] = ['confirmed', 'on_the_way', 'arrived', 'inspecting', 'quote_sent', 'payment_pending', 'in_progress'];

/** Customer "Upcoming" list: anything not finished. */
export const OPEN: BookingStatusValue[] = [...UNASSIGNED, ...ACTIVE_WITH_PRO];

export const isStatus = (v: unknown): v is BookingStatusValue => typeof v === 'string' && (ALL_STATUSES as readonly string[]).includes(v);

/** Visit charge collected online when booking; deducted from the final bill. */
export const VISIT_CHARGE = 99;

/** Seconds a professional has to accept an offered booking. */
export const OFFER_WINDOW_SECONDS = 120;

/** Wrong service-OTP entries allowed before the job locks. */
export const MAX_OTP_ATTEMPTS = 3;

/** Counter offers allowed per task: customer (1), professional (2), customer (3, final). */
export const MAX_COUNTER_ROUNDS = 3;
