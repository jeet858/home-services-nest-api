import { ValidationError } from '../common/errors/app-errors';
import { MAX_COUNTER_ROUNDS } from './booking-status';

// Pure rules for the inspection quote. No DB access, so both the customer and partner
// services share them and they can be unit-tested directly.

export type Party = 'provider' | 'customer';

export interface NegotiationLike {
  round: number;
  by: Party;
  price: number;
  note?: string | null;
}

export interface ItemLike {
  id: string;
  qty: number;
  price: number;
  finalPrice?: number | null;
  status: string;
  negotiations?: NegotiationLike[];
}

const RESOLVED = new Set(['accepted', 'rejected', 'declined', 'not_needed']);

export const money = (n: number) => Math.round(n * 100) / 100;

/** Counter offers made so far on a task. Round 0 is the professional's quote, so this equals the last round. */
export function counterCount(item: ItemLike) {
  const rounds = (item.negotiations ?? []).map((n) => n.round);
  return rounds.length ? Math.max(...rounds) : 0;
}

export function lastOffer(item: ItemLike): NegotiationLike | undefined {
  return [...(item.negotiations ?? [])].sort((a, b) => a.round - b.round).at(-1);
}

/** Whose move it is on a task, or null when the task is settled. */
export function turnOf(item: ItemLike): Party | null {
  if (RESOLVED.has(item.status)) return null;
  if (item.status === 'booked') return 'provider';
  const last = lastOffer(item);
  if (!last) return 'customer';
  return last.by === 'provider' ? 'customer' : 'provider';
}

/** What `party` may do on a task right now. */
export function allowedActions(item: ItemLike, party: Party): string[] {
  if (turnOf(item) !== party || item.status === 'booked') return [];
  const rounds = counterCount(item);
  if (party === 'customer') {
    // Customer counters on rounds 1 and 3; round 3 is final.
    return rounds < MAX_COUNTER_ROUNDS ? ['accept', 'reject', 'counter'] : ['accept', 'reject'];
  }
  // Professional counters only on round 2; after the customer's final round they accept or decline.
  return rounds < MAX_COUNTER_ROUNDS - 1 ? ['accept', 'counter', 'decline'] : ['accept', 'decline'];
}

export function assertAction(item: ItemLike, party: Party, action: string) {
  const allowed = allowedActions(item, party);
  if (!allowed.includes(action)) {
    throw new ValidationError(
      allowed.length ? `"${action}" is not allowed on this task now (allowed: ${allowed.join(', ')})` : 'This task is not waiting on you',
    );
  }
}

export function parsePrice(value: unknown, label = 'price') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`A valid ${label} is required`);
  if (n > 1_000_000) throw new ValidationError(`${label} is too large`);
  return money(n);
}

export const isSettled = (items: ItemLike[]) => items.length > 0 && items.every((i) => RESOLVED.has(i.status));

/** Sum of accepted tasks at their agreed unit price. */
export const acceptedSubtotal = (items: ItemLike[]) =>
  money(items.filter((i) => i.status === 'accepted').reduce((s, i) => s + (i.finalPrice ?? i.price) * i.qty, 0));

/** What the customer would pay if every open task were accepted at the current price. */
export const proposedSubtotal = (items: ItemLike[]) =>
  money(
    items
      .filter((i) => !['rejected', 'declined', 'not_needed'].includes(i.status))
      .reduce((s, i) => s + (i.status === 'accepted' ? (i.finalPrice ?? i.price) : (lastOffer(i)?.price ?? i.price)) * i.qty, 0),
  );

/**
 * Final bill once every task is settled. The visit charge is already paid and is the floor:
 * a job where the customer rejects everything still costs the visit.
 */
export function settle(items: ItemLike[], discount: number, visitingCharge: number) {
  const subtotal = acceptedSubtotal(items);
  const appliedDiscount = Math.min(discount, subtotal);
  const agreedTotal = money(Math.max(visitingCharge, subtotal - appliedDiscount));
  return { subtotal, discount: money(appliedDiscount), agreedTotal, due: money(agreedTotal - visitingCharge) };
}

/** Professional's share. Commission is on the job total; the tip goes to them in full. */
export function earnings(agreedTotal: number, commissionPct: number, tip: number) {
  const commissionAmount = money((agreedTotal * commissionPct) / 100);
  return { commissionAmount, providerEarning: money(agreedTotal - commissionAmount + tip) };
}
