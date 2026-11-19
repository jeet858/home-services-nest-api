// Pure matching maths: no database access, so it can be checked in isolation.
import { ASSIGNMENT } from './assignment.config';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const toMinutes = (t: unknown) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Day schedule allows the slot. A day marked available with no hours counts as all day. */
export function availableAt(availability: any, date: Date, time: string) {
  const day = availability?.[DAYS[date.getDay()]];
  if (!day) return true; // no schedule saved yet
  if (!day.available) return false;
  const slot = toMinutes(time);
  const start = toMinutes(day.start);
  const end = toMinutes(day.end);
  if (slot === null || start === null || end === null) return true;
  return slot >= start && slot < end;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** True when one of the day's other jobs sits within the buffer of this slot. Unparseable times count as a clash only if identical. */
export function slotClashes(slot: string, otherTimes: string[], bufferMin: number = ASSIGNMENT.slotBufferMin) {
  const at = toMinutes(slot);
  return otherTimes.some((t) => {
    const other = toMinutes(t);
    if (at === null || other === null) return t === slot;
    return Math.abs(other - at) < bufferMin;
  });
}

/** Smallest search radius that holds at least one candidate, or null when everyone is beyond the last ring. */
export function pickRing(distancesKm: number[], ringsKm: readonly number[] = ASSIGNMENT.ringsKm) {
  for (const ring of ringsKm) if (distancesKm.some((km) => km <= ring)) return ring;
  return null;
}

export interface CandidateStats {
  km: number;
  ratingAverage: number;
  ratingCount: number;
  /** Offers in the acceptance window, by outcome. */
  accepted: number;
  declined: number;
  /** Other active jobs on the booking's day. */
  jobsThatDay: number;
  /** Hours since this professional was last offered anything; null if never. */
  hoursSinceLastOffer: number | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** 0..1, higher is better. Each part is 0..1 and weighted by ASSIGNMENT.weights. */
export function scoreCandidate(c: CandidateStats, ringKm: number) {
  const w = ASSIGNMENT.weights;
  const parts = {
    distance: clamp01(1 - c.km / ringKm),
    // Bayesian average: five phantom 4.0 ratings stop a single review deciding the rank.
    rating: clamp01((c.ratingAverage * c.ratingCount + 4.0 * 5) / (c.ratingCount + 5) / 5),
    // Smoothed toward 70% so a new professional isn't treated as unreliable.
    acceptance: clamp01((c.accepted + 0.7 * 5) / (c.accepted + c.declined + 5)),
    workload: clamp01(1 - Math.min(c.jobsThatDay, 4) / 4),
    fairness: clamp01(Math.min(c.hoursSinceLastOffer ?? 24, 24) / 24),
  };
  const score = parts.distance * w.distance + parts.rating * w.rating + parts.acceptance * w.acceptance + parts.workload * w.workload + parts.fairness * w.fairness;
  return { score: Math.round(score * 1000) / 1000, parts };
}
