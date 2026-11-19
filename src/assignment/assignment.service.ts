import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { ACTIVE_WITH_PRO, OFFER_WINDOW_SECONDS } from '../booking/booking-status';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { ASSIGNMENT } from './assignment.config';
import { availableAt, haversineKm, pickRing, scoreCandidate, slotClashes } from './assignment.scoring';

export { availableAt, haversineKm };

const MIN = 60 * 1000;
const offerWindowText = () => {
  const m = OFFER_WINDOW_SECONDS / 60;
  return Number.isInteger(m) ? `${m} minute${m === 1 ? '' : 's'}` : `${OFFER_WINDOW_SECONDS} seconds`;
};
/** Another call created the offer first (partial unique indexes on open offers). */
const isUniqueViolation = (e: any) => e?.code === 'P2002' || /23505|unique constraint/i.test(String(e?.message ?? ''));

// Offers a booking to one professional at a time, with a short window to respond.
//
// Who gets the offer:
//   1. Hard filters: active, online, serves the service, working that slot, no open offer,
//      has a known location inside the last search ring, no other job close to the slot.
//   2. Rings: the smallest radius in ASSIGNMENT.ringsKm that holds a candidate.
//   3. Score inside that ring: distance, rating, acceptance rate, workload, fairness.
// When nobody is left (or it has taken too long) the booking is flagged for the admin team.
//
// Vercel is serverless, so expiry is swept lazily on every poll plus an external cron.
@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Offers the booking to the best available professional, or leaves it `searching`. */
  async assignNext(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        services: { select: { id: true } },
        address: true,
        assignments: { select: { providerId: true, status: true, respondedAt: true } },
        items: true,
      },
    });
    if (!booking || booking.status !== 'searching') return null;

    const at = booking.address?.lat != null && booking.address?.lng != null ? { lat: booking.address.lat, lng: booking.address.lng } : null;
    if (!at) {
      // Without a map pin there is nothing to measure distance from.
      await this.escalate(bookingId, 'no address coordinates');
      return null;
    }

    // Declined or dropped out: never again for this booking. Timed out: again after a cooldown.
    const retryAfter = Date.now() - ASSIGNMENT.expiredRetryCooldownMin * MIN;
    const excluded = [
      ...new Set(
        booking.assignments
          .filter((a) => a.status !== 'expired' || (a.respondedAt?.getTime() ?? Date.now()) > retryAfter)
          .map((a) => a.providerId),
      ),
    ];
    const serviceIds = booking.services.map((s) => s.id);
    const candidates = await this.prisma.serviceProvider.findMany({
      where: {
        status: 'active',
        isOnline: true,
        lastSeenAt: { gte: new Date(Date.now() - ASSIGNMENT.staleOnlineMs) },
        lat: { not: null },
        lng: { not: null },
        id: { notIn: excluded },
        ...(serviceIds.length ? { services: { some: { id: { in: serviceIds } } } } : {}),
        // One open offer at a time per professional (a lapsed one is cleared by the next sweep).
        assignments: { none: { status: 'offered' } },
      },
      select: {
        id: true,
        name: true,
        availability: true,
        lat: true,
        lng: true,
        ratingAverage: true,
        ratingTotal: true,
        // Their other jobs that day: used for the slot buffer and the workload score.
        bookings: { where: { date: booking.date, status: { in: ACTIVE_WITH_PRO as any } }, select: { time: true } },
      },
    });

    const maxKm = ASSIGNMENT.ringsKm[ASSIGNMENT.ringsKm.length - 1];
    const eligible = candidates
      .filter((p) => availableAt(p.availability, booking.date, booking.time))
      .filter((p) => !slotClashes(booking.time, p.bookings.map((b) => b.time)))
      .map((p) => ({ ...p, km: haversineKm(at, { lat: p.lat!, lng: p.lng! }) }))
      .filter((p) => p.km <= maxKm);

    const ring = pickRing(eligible.map((p) => p.km));
    if (ring === null) {
      logger.info('No professional available yet', { bookingId, tried: booking.assignments.length });
      // Nobody in range is left to ask: hand it to the admin team as well.
      await this.escalate(bookingId, 'no eligible professional in range');
      return null;
    }

    const inRing = eligible.filter((p) => p.km <= ring);
    const history = await this.offerHistory(inRing.map((p) => p.id));
    const ranked = inRing
      .map((p) => {
        const h = history.get(p.id);
        const { score } = scoreCandidate(
          {
            km: p.km,
            ratingAverage: p.ratingAverage,
            ratingCount: p.ratingTotal,
            accepted: h?.accepted ?? 0,
            declined: h?.declined ?? 0,
            jobsThatDay: p.bookings.length,
            hoursSinceLastOffer: h?.lastOfferAt ? (Date.now() - h.lastOfferAt.getTime()) / (60 * MIN) : null,
          },
          ring,
        );
        return { ...p, score };
      })
      .sort((a, b) => b.score - a.score || a.km - b.km);

    for (const pick of ranked) {
      const expiresAt = new Date(Date.now() + OFFER_WINDOW_SECONDS * 1000);
      let offer: { id: string } | null;
      try {
        offer = await this.prisma.$transaction(async (tx) => {
          // Claim the booking: only one concurrent caller moves it out of `searching`.
          const { count } = await tx.booking.updateMany({ where: { id: bookingId, status: 'searching' }, data: { status: 'offered' } });
          if (!count) return null;
          return tx.bookingAssignment.create({
            data: { bookingId, providerId: pick.id, expiresAt, distanceKm: Math.round(pick.km * 10) / 10, score: pick.score },
          });
        });
      } catch (e) {
        // This professional was just offered another booking: try the next best.
        if (isUniqueViolation(e)) continue;
        throw e;
      }
      if (!offer) return null; // another call is already handling this booking

      const names = booking.items.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ');
      await this.notifications.notify(
        { type: 'provider', id: pick.id },
        {
          type: 'booking_offered',
          title: 'New booking assigned',
          body: `${names || 'New job'}. Respond within ${offerWindowText()}.`,
          bookingId,
          data: { assignmentId: offer.id },
        },
      );
      logger.info('Booking offered', { bookingId, providerId: pick.id, km: pick.km, score: pick.score, ringKm: ring });
      const attempts = booking.assignments.length + 1;
      if (attempts >= ASSIGNMENT.maxOfferAttempts) await this.escalate(bookingId, `${attempts} offers made`);
      return offer;
    }
    return null;
  }

  /** Per professional: offers accepted / declined in the acceptance window, and when they were last offered anything. */
  private async offerHistory(providerIds: string[]) {
    const out = new Map<string, { accepted: number; declined: number; lastOfferAt: Date | null }>();
    if (!providerIds.length) return out;
    const rows = await this.prisma.bookingAssignment.groupBy({
      by: ['providerId', 'status'],
      where: { providerId: { in: providerIds }, createdAt: { gte: new Date(Date.now() - ASSIGNMENT.acceptanceWindowDays * 24 * 60 * MIN) } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    for (const r of rows) {
      const h = out.get(r.providerId) ?? { accepted: 0, declined: 0, lastOfferAt: null };
      if (r.status === 'accepted') h.accepted += r._count._all;
      if (r.status === 'rejected' || r.status === 'expired') h.declined += r._count._all;
      const last = r._max.createdAt;
      if (last && (!h.lastOfferAt || last > h.lastOfferAt)) h.lastOfferAt = last;
      out.set(r.providerId, h);
    }
    return out;
  }

  /** Flags the booking for manual assignment (once) and tells the customer we're still on it. */
  private async escalate(bookingId: string, why: string) {
    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, matchEscalatedAt: null, status: { in: ['searching', 'offered'] } },
      data: { matchEscalatedAt: new Date() },
    });
    if (!count) return false;
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true } });
    if (booking) {
      await this.notifications.notify(
        { type: 'user', id: booking.userId },
        {
          type: 'reassigning',
          title: 'Still finding your professional',
          body: 'This is taking longer than usual. Our team is helping to assign someone for your slot.',
          bookingId,
        },
      );
    }
    logger.warn('Booking escalated for manual assignment', { bookingId, why });
    return true;
  }

  /** Flags bookings that have been unmatched for too long. Run by the cron. */
  async escalateStale(limit = 20) {
    const cutoff = new Date(Date.now() - ASSIGNMENT.escalateAfterMin * MIN);
    const waiting = await this.prisma.booking.findMany({
      where: { status: { in: ['searching', 'offered'] }, matchEscalatedAt: null, createdAt: { lt: cutoff } },
      select: {
        id: true,
        // A professional backing out restarts the clock.
        assignments: { where: { status: 'cancelled' }, orderBy: { respondedAt: 'desc' }, take: 1, select: { respondedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let escalated = 0;
    for (const b of waiting) {
      const restarted = b.assignments[0]?.respondedAt;
      if (restarted && restarted > cutoff) continue;
      if (await this.escalate(b.id, `unmatched for ${ASSIGNMENT.escalateAfterMin} minutes`)) escalated++;
    }
    return escalated;
  }

  /** Expires lapsed offers and moves their bookings on. Optionally scoped to one booking or professional. */
  async sweepExpired(scope: { bookingId?: string; providerId?: string } = {}) {
    const lapsed = await this.prisma.bookingAssignment.findMany({
      where: { status: 'offered', expiresAt: { lt: new Date() }, ...scope },
      select: { id: true, bookingId: true, providerId: true },
      take: 50,
    });
    for (const a of lapsed) {
      // Conditional update so two concurrent sweeps don't both reassign.
      const { count } = await this.prisma.bookingAssignment.updateMany({
        where: { id: a.id, status: 'offered' },
        data: { status: 'expired', respondedAt: new Date() },
      });
      if (!count) continue;
      await this.prisma.booking.updateMany({ where: { id: a.bookingId, status: 'offered' }, data: { status: 'searching' } });
      await this.notifications.notify(
        { type: 'provider', id: a.providerId },
        {
          type: 'booking_offer_expired',
          title: 'Booking reassigned',
          body: 'You did not respond in time, so the booking went to another professional.',
          bookingId: a.bookingId,
        },
      );
      await this.assignNext(a.bookingId);
    }
    return lapsed.length;
  }

  /** Retries bookings still waiting for a professional (e.g. when someone comes online), soonest slot first. */
  async retrySearching(limit = 10) {
    // Repair: a booking marked `offered` with no open offer would otherwise never be retried.
    await this.prisma.booking.updateMany({
      where: { status: 'offered', assignments: { none: { status: 'offered' } } },
      data: { status: 'searching' },
    });
    const waiting = await this.prisma.booking.findMany({
      where: { status: 'searching', date: { gte: new Date(Date.now() - 24 * 60 * MIN) } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
      take: limit,
    });
    for (const b of waiting) await this.assignNext(b.id);
    return waiting.length;
  }

  async currentOffer(providerId: string) {
    await this.sweepExpired({ providerId });
    return this.prisma.bookingAssignment.findFirst({
      where: { providerId, status: 'offered', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async openOffer(assignmentId: string, providerId: string) {
    const offer = await this.prisma.bookingAssignment.findUnique({ where: { id: assignmentId } });
    if (!offer || offer.providerId !== providerId) throw new NotFoundError('Offer not found');
    if (offer.status !== 'offered' || offer.expiresAt < new Date()) {
      await this.sweepExpired({ bookingId: offer.bookingId });
      throw new ValidationError('This offer has expired');
    }
    return offer;
  }

  async accept(assignmentId: string, providerId: string) {
    const offer = await this.openOffer(assignmentId, providerId);
    const booking = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.bookingAssignment.updateMany({
        where: { id: offer.id, status: 'offered' },
        data: { status: 'accepted', respondedAt: new Date() },
      });
      if (!count) throw new ValidationError('This offer has expired');
      return tx.booking.update({
        where: { id: offer.bookingId },
        data: { status: 'accepted', serviceProviderId: providerId, assignedAt: new Date(), matchEscalatedAt: null },
        include: { serviceProvider: { select: { name: true } } },
      });
    });
    await this.notifications.notify(
      { type: 'user', id: booking.userId },
      {
        type: 'pro_assigned',
        title: `${booking.serviceProvider?.name ?? 'A professional'} accepted your booking`,
        body: 'They will confirm the final price after inspecting the work.',
        bookingId: booking.id,
      },
    );
    return booking;
  }

  async reject(assignmentId: string, providerId: string, reason?: unknown) {
    const offer = await this.openOffer(assignmentId, providerId);
    const { count } = await this.prisma.bookingAssignment.updateMany({
      where: { id: offer.id, status: 'offered' },
      data: { status: 'rejected', respondedAt: new Date(), reason: typeof reason === 'string' ? reason.slice(0, 300) : null },
    });
    if (count) {
      await this.prisma.booking.updateMany({ where: { id: offer.bookingId, status: 'offered' }, data: { status: 'searching' } });
      await this.assignNext(offer.bookingId);
    }
    return { rejected: true };
  }

  /** The professional backs out of an accepted job before arriving; the booking goes back to matching. */
  async release(bookingId: string, providerId: string, reason?: string) {
    await this.prisma.$transaction([
      this.prisma.bookingAssignment.updateMany({
        where: { bookingId, providerId, status: 'accepted' },
        data: { status: 'cancelled', reason: reason?.slice(0, 300) ?? null, respondedAt: new Date() },
      }),
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'searching', serviceProviderId: null, assignedAt: null, onTheWayAt: null, matchEscalatedAt: null },
      }),
    ]);
    return this.assignNext(bookingId);
  }

  /** Customer cancelled: withdraw any open offer. */
  async withdraw(bookingId: string) {
    await this.prisma.bookingAssignment.updateMany({
      where: { bookingId, status: 'offered' },
      data: { status: 'cancelled', respondedAt: new Date() },
    });
  }
}
