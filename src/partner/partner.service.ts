import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../common/errors/app-errors';
import { AssignmentService } from '../assignment/assignment.service';
import { ACTIVE_WITH_PRO, ONGOING } from '../booking/booking-status';
import { money } from '../booking/quote.domain';
import { Prisma } from '../generated/prisma/client';
import { JOB_INCLUDE, JobService } from '../job/job.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const maskAccount = (n?: string | null) => (n ? `••${n.slice(-4)}` : null);

/** Next Monday, the weekly payout day. */
const nextMonday = (from = new Date()) => {
  const d = startOfDay(from);
  const add = ((8 - d.getDay()) % 7) || 7;
  return new Date(d.getTime() + add * DAY_MS);
};

const LIST_SELECT = {
  id: true,
  date: true,
  time: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  estimatedTotal: true,
  agreedTotal: true,
  finalPrice: true,
  providerEarning: true,
  createdAt: true,
  completedAt: true,
  items: { select: { name: true, qty: true, status: true }, orderBy: { sortOrder: 'asc' } },
  address: { select: { street: true, city: true, landmark: true, lat: true, lng: true } },
  user: { select: { name: true } },
} satisfies Prisma.BookingSelect;

@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentService,
    private readonly jobService: JobService,
    private readonly storage: StorageService,
  ) {}

  private async provider(id: string) {
    const p = await this.prisma.serviceProvider.findUnique({
      where: { id },
      include: { documents: { orderBy: { uploadedAt: 'desc' } }, services: { select: { id: true, name: true } }, subservices: { select: { id: true, name: true } } },
    });
    if (!p) throw new NotFoundError('Partner account not found');
    return p;
  }

  /** Per-document checklist for the verification screen. */
  private checklist(p: Awaited<ReturnType<PartnerService['provider']>>) {
    const card = (image: string | null, verified: boolean) => (verified ? 'verified' : image ? 'pending' : 'not_added');
    const rows = [
      { key: 'aadhaar', label: 'Aadhaar', status: card(p.aadhaarImage, p.aadhaarVerified) },
      { key: 'pan', label: 'PAN', status: card(p.panImage, p.panVerified) },
      { key: 'photo', label: 'Passport photo', status: p.passportPhoto ? (p.status === 'active' ? 'verified' : 'pending') : 'not_added' },
      { key: 'bank', label: 'Bank details', status: p.bankAccountNumber ? 'verified' : 'not_added' },
      ...p.documents.map((d) => ({ key: d.id, label: d.name, status: d.status, reason: d.rejectReason })),
    ];
    return rows;
  }

  async me(providerId: string) {
    const p = await this.provider(providerId);
    return {
      id: p.id,
      name: p.name,
      phoneNumber: p.phoneNumber,
      email: p.email,
      photo: p.passportPhoto,
      status: p.status,
      canReceiveBookings: p.status === 'active',
      isOnline: p.isOnline,
      experience: p.experience,
      experienceUnit: p.experienceUnit,
      specializations: p.specializations,
      services: p.services,
      subservices: p.subservices,
      rating: { average: p.ratingAverage, count: p.ratingTotal },
      commission: p.commission,
      availability: p.availability,
      bank: p.bankAccountNumber
        ? { holder: p.bankAccountHolderName, bankName: p.bankName, ifsc: p.bankIfscCode, account: maskAccount(p.bankAccountNumber) }
        : null,
      documents: this.checklist(p),
      notes: p.status === 'suspended' ? p.notes : null,
    };
  }

  async setOnline(providerId: string, body: any) {
    const p = await this.provider(providerId);
    const online = body?.online === true;
    if (online && p.status !== 'active') throw new ValidationError('Your account must be verified before you can go online');
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    const hasPos = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    await this.prisma.serviceProvider.update({
      where: { id: providerId },
      data: {
        isOnline: online,
        lastSeenAt: new Date(),
        ...(hasPos ? { lat, lng } : {}),
        ...(typeof body?.fcmToken === 'string' ? { fcmToken: body.fcmToken.slice(0, 400) } : {}),
      },
    });
    // Someone new is available: give waiting bookings another try.
    if (online) await this.assignments.retrySearching(5);
    return { isOnline: online };
  }

  async setLocation(providerId: string, body: any) {
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (body?.lat == null || body?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new ValidationError('Send a valid lat and lng');
    }
    await this.prisma.serviceProvider.update({ where: { id: providerId }, data: { lat, lng, lastSeenAt: new Date() } });
    return { lat, lng };
  }

  async setAvailability(providerId: string, body: any) {
    const input = body?.availability ?? body;
    const availability: Record<string, any> = {};
    for (const day of DAYS) {
      const d = input?.[day];
      if (!d) {
        availability[day] = { available: false };
        continue;
      }
      const available = d.available !== false;
      if (available && (!TIME_RE.test(d.start ?? '') || !TIME_RE.test(d.end ?? ''))) {
        throw new ValidationError(`Set start and end times for ${day} (HH:mm)`);
      }
      if (available && d.start >= d.end) throw new ValidationError(`End time must be after start time on ${day}`);
      availability[day] = available ? { available, start: d.start, end: d.end } : { available: false, start: d.start, end: d.end };
    }
    await this.prisma.serviceProvider.update({ where: { id: providerId }, data: { availability } });
    return { availability };
  }

  async setBank(providerId: string, body: any) {
    const holder = String(body?.holder ?? '').trim();
    const account = String(body?.accountNumber ?? '').replace(/\s/g, '');
    const ifsc = String(body?.ifsc ?? '').trim().toUpperCase();
    const bankName = String(body?.bankName ?? '').trim();
    if (!holder) throw new ValidationError('Account holder name is required');
    if (!/^\d{9,18}$/.test(account)) throw new ValidationError('Enter a valid account number');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new ValidationError('Enter a valid IFSC code');
    await this.prisma.serviceProvider.update({
      where: { id: providerId },
      data: { bankAccountHolderName: holder, bankAccountNumber: account, bankIfscCode: ifsc, bankName: bankName || null },
    });
    return this.me(providerId);
  }

  async uploadDocument(providerId: string, body: any, file?: Express.Multer.File) {
    if (!file) throw new ValidationError('Attach the document image');
    // KYC slots the verification checklist reads; a new image always goes back to review.
    const type = String(body?.type ?? '');
    if (type === 'aadhaar' || type === 'pan' || type === 'photo') {
      const uploaded = await this.storage.uploadImage(file, type === 'photo' ? 'passportPhoto' : `${type}Card`);
      const number = typeof body?.number === 'string' ? body.number.replace(/\s/g, '').slice(0, 20) : undefined;
      const data =
        type === 'aadhaar'
          ? { aadhaarImage: uploaded.url, aadhaarS3Key: uploaded.key, aadhaarVerified: false, ...(number ? { aadhaarNumber: number } : {}) }
          : type === 'pan'
            ? { panImage: uploaded.url, panS3Key: uploaded.key, panVerified: false, ...(number ? { panNumber: number.toUpperCase() } : {}) }
            : { passportPhoto: uploaded.url, passportPhotoS3Key: uploaded.key };
      await this.prisma.serviceProvider.update({ where: { id: providerId }, data });
      return this.me(providerId);
    }
    const name = String(body?.name ?? '').trim().slice(0, 80);
    if (!name) throw new ValidationError('Document name is required');
    const uploaded = await this.storage.uploadImage(file, 'documents');
    await this.prisma.providerDocument.create({
      data: { providerId, type: String(body?.type ?? 'certificate').slice(0, 40), name, url: uploaded.url, status: 'pending' },
    });
    return this.me(providerId);
  }

  // ---------- Offers ----------

  async currentOffer(providerId: string) {
    // Polling for offers counts as being present.
    await this.prisma.serviceProvider.update({ where: { id: providerId }, data: { lastSeenAt: new Date() } });
    const offer = await this.assignments.currentOffer(providerId);
    if (!offer) return null;
    const b = await this.prisma.booking.findUnique({ where: { id: offer.bookingId }, include: JOB_INCLUDE });
    if (!b) return null;
    const p = await this.prisma.serviceProvider.findUnique({ where: { id: providerId }, select: { lat: true, lng: true, commission: true } });
    const km =
      p?.lat != null && p?.lng != null && b.address?.lat != null && b.address?.lng != null
        ? Math.round(Math.hypot((b.address.lat - p.lat) * 111, (b.address.lng - p.lng) * 111 * Math.cos((p.lat * Math.PI) / 180)) * 10) / 10
        : null;
    const pct = p?.commission ?? 10;
    const customerSince = await this.prisma.user.findUnique({ where: { id: b.userId }, select: { createdAt: true } });
    return {
      assignmentId: offer.id,
      expiresAt: offer.expiresAt,
      createdAt: offer.createdAt,
      serverTime: new Date(),
      booking: {
        id: b.id,
        date: b.date,
        time: b.time,
        services: b.services,
        items: b.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, price: i.price })),
        area: b.address ? [b.address.street, b.address.city].filter(Boolean).join(', ') : null,
        lat: b.address?.lat ?? null,
        lng: b.address?.lng ?? null,
        distanceKm: km,
        estimatedTotal: b.estimatedTotal,
        estimatedEarning: money(b.estimatedTotal - (b.estimatedTotal * pct) / 100),
        commissionPct: pct,
        customerSince: customerSince?.createdAt ?? null,
        notes: b.notes,
      },
    };
  }

  // ---------- Jobs ----------

  async jobs(providerId: string, tab = 'upcoming', range?: string) {
    const where: Prisma.BookingWhereInput = { serviceProviderId: providerId };
    if (tab === 'upcoming') where.status = 'accepted';
    else if (tab === 'ongoing') where.status = { in: ONGOING as any };
    else if (tab === 'completed') where.status = 'completed';
    else if (tab === 'cancelled') where.status = 'cancelled';
    else throw new ValidationError('Unknown tab');

    const today = startOfDay();
    if (range === 'today') where.date = { gte: today, lt: new Date(today.getTime() + DAY_MS) };
    else if (range === 'tomorrow') where.date = { gte: new Date(today.getTime() + DAY_MS), lt: new Date(today.getTime() + 2 * DAY_MS) };
    else if (range === 'week') where.date = { gte: today, lt: new Date(today.getTime() + 7 * DAY_MS) };

    const rows = await this.prisma.booking.findMany({
      where,
      select: LIST_SELECT,
      orderBy: tab === 'completed' || tab === 'cancelled' ? { date: 'desc' } : [{ date: 'asc' }, { time: 'asc' }],
      take: 50,
    });
    const jobs = rows.map((r) => ({ ...r, source: 'job' as const }));

    // Offers this professional turned down show in Cancelled as "Rejected by you".
    let rejected: any[] = [];
    if (tab === 'cancelled') {
      const offers = await this.prisma.bookingAssignment.findMany({
        where: { providerId, status: { in: ['rejected', 'expired'] } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { booking: { select: LIST_SELECT } },
      });
      rejected = offers.map((o) => ({ ...o.booking, status: o.status === 'rejected' ? 'rejected_by_you' : 'missed', source: 'offer' as const }));
    }

    const counts = await this.counts(providerId);
    return { jobs: [...jobs, ...rejected], counts };
  }

  private async counts(providerId: string) {
    const [upcoming, ongoing] = await Promise.all([
      this.prisma.booking.count({ where: { serviceProviderId: providerId, status: 'accepted' } }),
      this.prisma.booking.count({ where: { serviceProviderId: providerId, status: { in: ONGOING as any } } }),
    ]);
    return { upcoming, ongoing };
  }

  async job(providerId: string, bookingId: string) {
    return this.jobService.providerView(await this.jobService.loadForProvider(bookingId, providerId));
  }

  /** Subservices from the booking's category, for "Add from catalogue". */
  async catalogue(providerId: string, bookingId: string, search?: string) {
    const b = await this.jobService.loadForProvider(bookingId, providerId);
    const q = search?.trim();
    return this.prisma.subservice.findMany({
      where: {
        serviceId: { in: b.services.map((s) => s.id) },
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      select: { id: true, name: true, description: true, discountedPrice: true, originalPrice: true, duration: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
  }

  // ---------- Dashboard and earnings ----------

  async dashboard(providerId: string) {
    const p = await this.prisma.serviceProvider.findUnique({
      where: { id: providerId },
      select: { name: true, passportPhoto: true, status: true, isOnline: true, ratingAverage: true, ratingTotal: true },
    });
    if (!p) throw new NotFoundError('Partner account not found');
    await this.prisma.serviceProvider.update({ where: { id: providerId }, data: { lastSeenAt: new Date() } });

    const today = startOfDay();
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const [earnedToday, jobsToday, active, offer, unread] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { serviceProviderId: providerId, status: 'completed', completedAt: { gte: today } },
        _sum: { providerEarning: true },
      }),
      this.prisma.booking.count({
        where: { serviceProviderId: providerId, date: { gte: today, lt: tomorrow }, status: { not: 'cancelled' } },
      }),
      this.prisma.booking.findMany({
        where: { serviceProviderId: providerId, status: { in: ACTIVE_WITH_PRO as any } },
        select: LIST_SELECT,
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        take: 10,
      }),
      p.isOnline ? this.currentOffer(providerId) : Promise.resolve(null),
      this.prisma.notification.count({ where: { recipientType: 'provider', recipientId: providerId, readAt: null } }),
    ]);

    // Work in progress first, then jobs mid-visit, then the earliest accepted one.
    const rank = (s: string) => (s === 'in_progress' ? 0 : s === 'accepted' ? 2 : 1);
    const sorted = [...active].sort((a, b) => rank(a.status) - rank(b.status));
    const [next, ...rest] = sorted;
    return {
      name: p.name,
      photo: p.passportPhoto,
      status: p.status,
      isOnline: p.isOnline,
      rating: { average: p.ratingAverage, count: p.ratingTotal },
      todayEarnings: money(earnedToday._sum.providerEarning ?? 0),
      jobsToday,
      nextJob: next ?? null,
      schedule: rest.filter((j) => j.date >= today && j.date < tomorrow),
      offer,
      unread,
    };
  }

  async earnings(providerId: string, period = 'week') {
    const now = new Date();
    const today = startOfDay(now);
    const span = period === 'today' ? 1 : period === 'month' ? 30 : 7;
    if (!['today', 'week', 'month'].includes(period)) throw new ValidationError('Period must be today, week or month');
    const from = new Date(today.getTime() - (span - 1) * DAY_MS);
    const prevFrom = new Date(from.getTime() - span * DAY_MS);

    const done = await this.prisma.booking.findMany({
      where: { serviceProviderId: providerId, status: 'completed', completedAt: { gte: prevFrom } },
      select: {
        id: true,
        completedAt: true,
        paymentMethod: true,
        agreedTotal: true,
        finalPrice: true,
        visitingCharge: true,
        visitChargePaid: true,
        commissionAmount: true,
        providerEarning: true,
        tip: true,
        items: { where: { status: 'accepted' }, select: { name: true }, take: 1 },
      },
      orderBy: { completedAt: 'desc' },
    });
    const inPeriod = done.filter((b) => b.completedAt! >= from);
    const prev = done.filter((b) => b.completedAt! < from);
    const sum = (rows: typeof done, f: (b: (typeof done)[number]) => number) => money(rows.reduce((s, b) => s + f(b), 0));

    const earned = (b: (typeof done)[number]) => b.providerEarning ?? 0;
    const cashPart = (b: (typeof done)[number]) =>
      b.paymentMethod === 'cash' ? Math.max(0, (b.agreedTotal ?? b.finalPrice) - (b.visitChargePaid ? b.visitingCharge : 0)) : 0;

    const total = sum(inPeriod, earned);
    const prevTotal = sum(prev, earned);
    const cashCollected = sum(inPeriod, cashPart);
    const jobTotal = sum(inPeriod, (b) => b.agreedTotal ?? b.finalPrice);
    const commission = sum(inPeriod, (b) => b.commissionAmount ?? 0);

    // Last 7 days, oldest first, for the bar chart.
    const series = Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(today.getTime() - (6 - i) * DAY_MS);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      return { date: dayStart, amount: sum(done.filter((b) => b.completedAt! >= dayStart && b.completedAt! < dayEnd), earned) };
    });

    // Everything since the last paid payout is unsettled. Cash already in hand is netted off.
    const lastPaid = await this.prisma.payout.findFirst({ where: { providerId, status: 'paid' }, orderBy: { periodEnd: 'desc' } });
    const unsettled = await this.prisma.booking.findMany({
      where: { serviceProviderId: providerId, status: 'completed', ...(lastPaid ? { completedAt: { gt: lastPaid.periodEnd } } : {}) },
      select: { providerEarning: true, paymentMethod: true, agreedTotal: true, finalPrice: true, visitingCharge: true, visitChargePaid: true, commissionAmount: true },
    });
    const unsettledEarned = money(unsettled.reduce((s, b) => s + (b.providerEarning ?? 0), 0));
    const unsettledCash = money(unsettled.reduce((s, b) => s + cashPart(b as any), 0));
    const p = await this.prisma.serviceProvider.findUnique({ where: { id: providerId }, select: { bankName: true, bankAccountNumber: true } });

    return {
      period,
      total,
      changePct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
      jobsDone: inPeriod.length,
      jobTotal,
      cashCollected,
      online: money(jobTotal - cashCollected),
      commission,
      // Commission owed on cash jobs is taken from the next payout.
      commissionDue: sum(inPeriod.filter((b) => b.paymentMethod === 'cash'), (b) => b.commissionAmount ?? 0),
      series,
      nextPayout: {
        date: nextMonday(now),
        amount: money(Math.max(0, unsettledEarned - unsettledCash)),
        bank: p?.bankAccountNumber ? `${p.bankName ?? 'Bank'} ${maskAccount(p.bankAccountNumber)}` : null,
      },
      transactions: inPeriod.slice(0, 30).map((b) => ({
        bookingId: b.id,
        title: b.items[0]?.name ?? 'Job',
        date: b.completedAt,
        jobTotal: b.agreedTotal ?? b.finalPrice,
        commission: b.commissionAmount ?? 0,
        tip: b.tip,
        net: earned(b),
        paymentMethod: b.paymentMethod,
      })),
    };
  }
}
