// Tunables for automatic matching. Each can be overridden by an env var without a code change.

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const rings = (process.env.ASSIGN_RADIUS_RINGS_KM ?? '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a - b);

export const ASSIGNMENT = {
  /** Search widens through these radii (km); the last one is the hard limit. */
  ringsKm: rings.length ? rings : [5, 10, 20],
  /** A professional with another job this close (minutes) to the slot is skipped. */
  slotBufferMin: num('ASSIGN_SLOT_BUFFER_MIN', 90),
  /** A professional whose offer timed out can be offered the same booking again after this long. */
  expiredRetryCooldownMin: num('ASSIGN_EXPIRED_RETRY_COOLDOWN_MIN', 10),
  /** Offers made before the booking is flagged for the admin team. */
  maxOfferAttempts: num('ASSIGN_MAX_OFFER_ATTEMPTS', 6),
  /** Minutes a booking may stay unmatched before it is flagged for the admin team. */
  escalateAfterMin: num('ASSIGN_ESCALATE_AFTER_MIN', 15),
  /** Days of offer history behind the acceptance rate. */
  acceptanceWindowDays: 30,
  /** A professional who hasn't pinged the server for this long is treated as offline. */
  staleOnlineMs: 20 * 60 * 1000,
  /** Score weights; they add up to 1. */
  weights: { distance: 0.4, rating: 0.2, acceptance: 0.15, workload: 0.15, fairness: 0.1 },
} as const;
