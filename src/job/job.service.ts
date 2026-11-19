import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { AssignmentService } from '../assignment/assignment.service';
import { ACTIVE_WITH_PRO, MAX_OTP_ATTEMPTS } from '../booking/booking-status';
import {
  acceptedSubtotal,
  allowedActions,
  assertAction,
  counterCount,
  earnings,
  isSettled,
  lastOffer,
  money,
  Party,
  parsePrice,
  proposedSubtotal,
  settle,
  turnOf,
} from '../booking/quote.domain';
import { Prisma } from '../generated/prisma/client';
import { NotificationService } from '../notification/notification.service';
import { PaymentService } from '../payment/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export const JOB_INCLUDE = {
  items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { negotiations: { orderBy: { round: 'asc' } } } },
  user: { select: { id: true, name: true, phoneNumber: true } },
  address: true,
  services: { select: { id: true, name: true } },
  serviceProvider: { select: { id: true, name: true, phoneNumber: true, passportPhoto: true, ratingAverage: true, ratingTotal: true, commission: true } },
  payments: { where: { status: 'paid' }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BookingInclude;

export type JobRow = Prisma.BookingGetPayload<{ include: typeof JOB_INCLUDE }>;

const maskPhone = (p?: string | null) => (p ? `${p.slice(0, 2)}••••••${p.slice(-2)}` : null);

@Injectable()
export class JobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly assignments: AssignmentService,
    private readonly payments: PaymentService,
    private readonly storage: StorageService,
  ) {}

  // ---------- Loading and views ----------

  private async load(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: JOB_INCLUDE });
    if (!booking) throw new NotFoundError('Booking not found');
    return booking;
  }

  async loadForProvider(bookingId: string, providerId: string) {
    const booking = await this.load(bookingId);
    if (booking.serviceProviderId !== providerId) throw new NotFoundError('Job not found');
    return booking;
  }

  async loadForCustomer(bookingId: string, userId: string) {
    const booking = await this.load(bookingId);
    if (booking.userId !== userId) throw new NotFoundError('Booking not found');
    return booking;
  }

  private expect(booking: { status: string }, allowed: string[], action: string) {
    if (!allowed.includes(booking.status)) {
      throw new ValidationError(`Cannot ${action} while the booking is ${booking.status.replace(/_/g, ' ')}`);
    }
  }

  itemView(item: JobRow['items'][number], party: Party) {
    const last = lastOffer(item as any);
    return {
      id: item.id,
      subserviceId: item.subserviceId,
      name: item.name,
      description: item.description,
      qty: item.qty,
      catalogPrice: item.catalogPrice,
      price: last?.price ?? item.price,
      quotedPrice: item.price,
      finalPrice: item.finalPrice,
      isAdditional: item.isAdditional,
      reason: item.reason,
      status: item.status,
      done: item.done,
      round: counterCount(item as any),
      lastOffer: last ? { by: last.by, price: last.price, note: last.note ?? null } : null,
      history: item.negotiations.map((n) => ({ round: n.round, by: n.by, price: n.price, note: n.note, at: n.createdAt })),
      awaiting: turnOf(item as any),
      actions: allowedActions(item as any, party),
    };
  }

  totals(b: JobRow) {
    const items = b.items as any[];
    const visitPaid = b.visitChargePaid ? b.visitingCharge : 0;
    const settled = isSettled(items) ? settle(items, b.discount, b.visitingCharge) : null;
    const paidOnline = b.payments.filter((p) => p.kind === 'quote').reduce((s, p) => s + p.amount, 0);
    return {
      estimate: b.estimatedTotal,
      revised: proposedSubtotal(items),
      accepted: acceptedSubtotal(items),
      discount: b.discount,
      couponCode: b.couponCode,
      visitingCharge: b.visitingCharge,
      visitChargePaid: b.visitChargePaid,
      agreedTotal: b.agreedTotal ?? settled?.agreedTotal ?? null,
      due: b.agreedTotal != null ? money(Math.max(0, b.agreedTotal - visitPaid - paidOnline)) : null,
      tip: b.tip,
    };
  }

  /** The job as the professional sees it. The service OTP is never included. */
  providerView(b: JobRow) {
    const { serviceOtp, user, payments, ...rest } = b;
    const pct = b.commissionPct ?? b.serviceProvider?.commission ?? 10;
    const estimate = b.agreedTotal ?? b.estimatedTotal;
    return {
      ...rest,
      customer: user ? { id: user.id, name: user.name, phoneNumber: user.phoneNumber, maskedPhone: maskPhone(user.phoneNumber) } : null,
      items: b.items.map((i) => this.itemView(i, 'provider')),
      totals: this.totals(b),
      estimatedEarning: money(estimate - (estimate * pct) / 100),
      commissionPct: pct,
      payments: payments.map((p) => ({ kind: p.kind, method: p.method, amount: p.amount, paidAt: p.paidAt, razorpayPaymentId: p.razorpayPaymentId })),
    };
  }

  customerQuoteView(b: JobRow) {
    return {
      bookingId: b.id,
      status: b.status,
      quoteRound: b.quoteRound,
      quoteSentAt: b.quoteSentAt,
      quoteNote: b.quoteNote,
      issuePhotos: b.issuePhotos,
      professional: b.serviceProvider
        ? { id: b.serviceProvider.id, name: b.serviceProvider.name, photo: b.serviceProvider.passportPhoto, rating: b.serviceProvider.ratingAverage }
        : null,
      items: b.items.map((i) => this.itemView(i, 'customer')),
      totals: this.totals(b),
      paymentMethod: b.paymentMethod,
      paymentStatus: b.paymentStatus,
    };
  }

  private notifyCustomer(b: { id: string; userId: string }, type: string, title: string, body: string, data?: Record<string, any>) {
    return this.notifications.notify({ type: 'user', id: b.userId }, { type, title, body, bookingId: b.id, data });
  }

  private notifyProvider(b: { id: string; serviceProviderId: string | null }, type: string, title: string, body: string, data?: Record<string, any>) {
    if (!b.serviceProviderId) return Promise.resolve();
    return this.notifications.notify({ type: 'provider', id: b.serviceProviderId }, { type, title, body, bookingId: b.id, data });
  }

  private proName(b: JobRow) {
    return b.serviceProvider?.name?.split(' ')[0] ?? 'Your professional';
  }

  // ---------- Visit ----------

  async startTrip(bookingId: string, providerId: string) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['accepted'], 'start the trip');
    await this.prisma.booking.update({ where: { id: b.id }, data: { status: 'on_the_way', onTheWayAt: new Date() } });
    await this.notifyCustomer(b, 'pro_on_the_way', `${this.proName(b)} is on the way`, 'Keep your service OTP ready to share when they arrive.');
    return this.providerView(await this.load(b.id));
  }

  async arrived(bookingId: string, providerId: string) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['accepted', 'on_the_way'], 'mark arrival');
    await this.prisma.booking.update({ where: { id: b.id }, data: { status: 'arrived', arrivedAt: new Date(), onTheWayAt: b.onTheWayAt ?? new Date() } });
    await this.notifyCustomer(b, 'pro_arrived', `${this.proName(b)} has arrived`, 'Share your service OTP so they can start the inspection.');
    return this.providerView(await this.load(b.id));
  }

  async verifyServiceOtp(bookingId: string, providerId: string, otp: unknown) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['on_the_way', 'arrived'], 'verify the OTP');
    if (b.otpAttempts >= MAX_OTP_ATTEMPTS) throw new ValidationError('Too many wrong attempts. Contact Subidha support to continue.');

    if (!b.serviceOtp || String(otp ?? '').trim() !== b.serviceOtp) {
      const attempts = b.otpAttempts + 1;
      await this.prisma.booking.update({ where: { id: b.id }, data: { otpAttempts: attempts } });
      const left = MAX_OTP_ATTEMPTS - attempts;
      throw new ValidationError(
        left > 0 ? `Incorrect OTP, ${left} ${left === 1 ? 'attempt' : 'attempts'} left` : 'Too many wrong attempts. Contact Subidha support to continue.',
        [{ attemptsLeft: left }],
      );
    }

    await this.prisma.booking.update({
      where: { id: b.id },
      data: { status: 'inspecting', inspectionAt: new Date(), arrivedAt: b.arrivedAt ?? new Date() },
    });
    await this.notifyCustomer(b, 'inspection_started', 'Inspection started', `${this.proName(b)} is checking the work and will send you a quote.`);
    return this.providerView(await this.load(b.id));
  }

  async addPhotos(bookingId: string, providerId: string, kind: unknown, files: Express.Multer.File[] = []) {
    const b = await this.loadForProvider(bookingId, providerId);
    if (!files.length) throw new ValidationError('Add at least one photo');
    const field = kind === 'after' ? 'afterPhotos' : 'issuePhotos';
    const uploaded = await Promise.all(files.map((f) => this.storage.uploadImage(f, `jobs/${field}`)));
    const urls = [...(b[field] ?? []), ...uploaded.map((u) => u.url)].slice(-6);
    await this.prisma.booking.update({ where: { id: b.id }, data: { [field]: urls } });
    return { [field]: urls };
  }

  // ---------- Quote ----------

  /**
   * Professional sends the inspected quote: booked tasks with adjusted qty/price (or marked not needed),
   * plus additional tasks from the catalogue or custom.
   */
  async sendQuote(bookingId: string, providerId: string, body: any) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['inspecting'], 'send a quote');

    const booked = new Map(b.items.map((i) => [i.id, i]));
    const edits: any[] = Array.isArray(body?.items) ? body.items : [];
    const additions: any[] = Array.isArray(body?.additional) ? body.additional : [];
    if (additions.length > 20) throw new ValidationError('Too many additional tasks');

    const serviceIds = b.services.map((s) => s.id);
    const catalogue = additions.some((a) => a?.subserviceId)
      ? await this.prisma.subservice.findMany({
          where: { id: { in: additions.map((a) => a?.subserviceId).filter(Boolean) }, ...(serviceIds.length ? { serviceId: { in: serviceIds } } : {}) },
        })
      : [];

    const proposedOrNot = await this.prisma.$transaction(async (tx) => {
      let open = 0;
      for (const item of b.items) {
        const edit = edits.find((e) => e?.id === item.id) ?? {};
        if (edit.required === false) {
          await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'not_needed', reason: typeof edit.reason === 'string' ? edit.reason : item.reason } });
          continue;
        }
        const qty = edit.qty === undefined ? item.qty : Math.max(1, Math.min(50, Math.round(Number(edit.qty) || 1)));
        const price = edit.price === undefined ? item.price : parsePrice(edit.price);
        const reason = price !== item.catalogPrice && typeof edit.reason === 'string' ? edit.reason.slice(0, 200) : null;
        await tx.bookingItem.update({ where: { id: item.id }, data: { qty, price, reason, status: 'proposed' } });
        await tx.itemNegotiation.create({ data: { itemId: item.id, round: 0, by: 'provider', price } });
        open++;
      }

      let order = b.items.length;
      for (const a of additions) {
        const sub = a?.subserviceId ? catalogue.find((c) => c.id === a.subserviceId) : null;
        if (a?.subserviceId && !sub) throw new ValidationError('Additional tasks must come from this service category');
        const name = sub?.name ?? (typeof a?.name === 'string' ? a.name.trim().slice(0, 120) : '');
        if (!name) throw new ValidationError('Each additional task needs a name');
        const qty = Math.max(1, Math.min(50, Math.round(Number(a?.qty) || 1)));
        const price = parsePrice(a?.price ?? sub?.discountedPrice);
        const created = await tx.bookingItem.create({
          data: {
            bookingId: b.id,
            subserviceId: sub?.id ?? null,
            name,
            description: typeof a?.description === 'string' ? a.description.slice(0, 300) : (sub?.description ?? null),
            qty,
            catalogPrice: sub?.discountedPrice ?? 0,
            price,
            isAdditional: true,
            reason: typeof a?.reason === 'string' ? a.reason.slice(0, 200) : null,
            status: 'proposed',
            sortOrder: order++,
          },
        });
        await tx.itemNegotiation.create({ data: { itemId: created.id, round: 0, by: 'provider', price } });
        open++;
      }

      await tx.booking.update({
        where: { id: b.id },
        data: {
          status: 'quote_sent',
          quoteSentAt: new Date(),
          quoteRound: 0,
          quoteNote: typeof body?.note === 'string' ? body.note.slice(0, 500) : null,
        },
      });
      return open;
    });

    if (proposedOrNot === 0) {
      await this.settleIfDone(b.id);
    } else {
      const extra = additions.length;
      await this.notifyCustomer(
        b,
        'quote_ready',
        'Your quote is ready',
        `${this.proName(b)} confirmed ${proposedOrNot} ${proposedOrNot === 1 ? 'task' : 'tasks'}${extra ? `, including ${extra} extra` : ''}. Review it to continue.`,
      );
    }
    return this.providerView(await this.load(b.id));
  }

  /** One response per task; `acceptAll` accepts everything currently waiting on the customer. */
  async customerRespond(bookingId: string, userId: string, body: any) {
    const b = await this.loadForCustomer(bookingId, userId);
    this.expect(b, ['quote_sent'], 'respond to the quote');

    const responses: any[] = body?.acceptAll
      ? b.items.filter((i) => turnOf(i as any) === 'customer').map((i) => ({ id: i.id, action: 'accept' }))
      : Array.isArray(body?.items)
        ? body.items
        : [];
    if (!responses.length) throw new ValidationError('Respond to at least one task');

    const tally = { accept: 0, reject: 0, counter: 0 };
    await this.prisma.$transaction(async (tx) => {
      for (const r of responses) {
        const item = b.items.find((i) => i.id === r?.id);
        if (!item) throw new ValidationError('Unknown task in response');
        const action = String(r.action);
        assertAction(item as any, 'customer', action);
        const offer = lastOffer(item as any)?.price ?? item.price;

        if (action === 'accept') {
          await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'accepted', finalPrice: offer } });
        } else if (action === 'reject') {
          await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'rejected' } });
        } else {
          const price = parsePrice(r.price, 'counter price');
          if (price >= offer) throw new ValidationError(`A counter offer for ${item.name} must be below ₹${offer}`);
          await tx.itemNegotiation.create({
            data: { itemId: item.id, round: counterCount(item as any) + 1, by: 'customer', price, note: typeof r.note === 'string' ? r.note.slice(0, 200) : null },
          });
          await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'countered' } });
        }
        tally[action as keyof typeof tally]++;
      }
    });

    await this.bumpRound(b.id);
    const settled = await this.settleIfDone(b.id);
    if (!settled) {
      const parts = [
        tally.accept && `accepted ${tally.accept}`,
        tally.reject && `rejected ${tally.reject}`,
        tally.counter && `countered ${tally.counter}`,
      ].filter(Boolean);
      await this.notifyProvider(
        b,
        tally.counter ? 'quote_countered' : 'quote_response',
        tally.counter ? `${b.user.name ?? 'Customer'} sent a counter offer` : `${b.user.name ?? 'Customer'} responded to your quote`,
        `They ${parts.join(', ')} ${responses.length === 1 ? 'task' : 'tasks'}.`,
      );
    }
    return this.customerQuoteView(await this.load(b.id));
  }

  async providerRespond(bookingId: string, providerId: string, itemId: string, body: any) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['quote_sent'], 'respond to a counter offer');
    const item = b.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundError('Task not found');
    const action = String(body?.action);
    assertAction(item as any, 'provider', action);
    const offer = lastOffer(item as any)!.price;

    if (action === 'accept') {
      await this.prisma.bookingItem.update({ where: { id: item.id }, data: { status: 'accepted', finalPrice: offer } });
    } else if (action === 'decline') {
      await this.prisma.bookingItem.update({ where: { id: item.id }, data: { status: 'declined' } });
    } else {
      const price = parsePrice(body?.price, 'counter price');
      const mine = [...item.negotiations].reverse().find((n) => n.by === 'provider')?.price ?? item.price;
      if (price <= offer || price >= mine) throw new ValidationError(`Your counter must be between ₹${offer} and ₹${mine}`);
      await this.prisma.$transaction([
        this.prisma.itemNegotiation.create({
          data: { itemId: item.id, round: counterCount(item as any) + 1, by: 'provider', price, note: typeof body?.note === 'string' ? body.note.slice(0, 200) : null },
        }),
        this.prisma.bookingItem.update({ where: { id: item.id }, data: { status: 'countered' } }),
      ]);
    }

    await this.bumpRound(b.id);
    const settled = await this.settleIfDone(b.id);
    if (!settled) {
      const titles: Record<string, string> = {
        accept: `${this.proName(b)} accepted your offer for ${item.name}`,
        decline: `${this.proName(b)} removed ${item.name} from the quote`,
        counter: `${this.proName(b)} countered with ₹${body?.price} for ${item.name}`,
      };
      await this.notifyCustomer(b, 'quote_updated', titles[action], 'Open the quote to see where things stand.');
    }
    return this.providerView(await this.load(b.id));
  }

  async remindCustomer(bookingId: string, providerId: string) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['quote_sent', 'payment_pending'], 'send a reminder');
    const recent = await this.prisma.notification.findFirst({
      where: { recipientType: 'user', recipientId: b.userId, bookingId: b.id, type: 'reminder', createdAt: { gt: new Date(Date.now() - 2 * 60 * 1000) } },
    });
    if (recent) throw new ValidationError('A reminder was sent less than 2 minutes ago');
    await this.notifyCustomer(
      b,
      'reminder',
      `${this.proName(b)} is waiting for you`,
      b.status === 'quote_sent' ? 'Review the quote so work can begin.' : 'Complete the payment so work can begin.',
    );
    return { reminded: true };
  }

  private async bumpRound(bookingId: string) {
    const items = await this.prisma.bookingItem.findMany({ where: { bookingId }, include: { negotiations: true } });
    const round = Math.max(0, ...items.map((i) => counterCount(i as any)));
    await this.prisma.booking.update({ where: { id: bookingId }, data: { quoteRound: round } });
  }

  /** When every task is settled: fix the bill and move to payment (or close an inspection-only visit). */
  private async settleIfDone(bookingId: string) {
    const b = await this.load(bookingId);
    if (b.status !== 'quote_sent' || !isSettled(b.items as any)) return false;
    const { subtotal, agreedTotal, due } = settle(b.items as any, b.discount, b.visitingCharge);

    if (subtotal === 0) {
      const pct = b.serviceProvider?.commission ?? 10;
      const { commissionAmount, providerEarning } = earnings(agreedTotal, pct, b.tip);
      await this.prisma.booking.update({
        where: { id: b.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          quoteApprovedAt: new Date(),
          agreedTotal,
          finalPrice: agreedTotal,
          paymentStatus: 'paid',
          commissionPct: pct,
          commissionAmount,
          providerEarning,
        },
      });
      await this.notifyCustomer(b, 'visit_closed', 'Visit closed', `No tasks were agreed, so only the ₹${b.visitingCharge} visit charge applies.`);
      await this.notifyProvider(b, 'visit_closed', 'Visit closed with no work', `You earn ₹${providerEarning} for the visit.`);
      return true;
    }

    await this.prisma.booking.update({
      where: { id: b.id },
      data: {
        status: 'payment_pending',
        quoteApprovedAt: new Date(),
        agreedTotal,
        finalPrice: agreedTotal,
        ...(due <= 0 ? { paymentStatus: 'paid' as const } : {}),
      },
    });
    await this.notifyCustomer(b, 'quote_agreed', 'Quote agreed', due > 0 ? `Pay ₹${due} to begin the work.` : 'Nothing more to pay. Work can begin.');
    await this.notifyProvider(
      b,
      'quote_approved',
      `${b.user.name ?? 'Customer'} approved the quote`,
      due > 0 ? `Agreed total ₹${agreedTotal}. Collect payment before starting work.` : `Agreed total ₹${agreedTotal}. You can start work.`,
    );
    return true;
  }

  // ---------- Payment ----------

  private dueOf(b: JobRow) {
    return this.totals(b).due ?? 0;
  }

  async createQuoteOrder(bookingId: string, userId: string) {
    const b = await this.loadForCustomer(bookingId, userId);
    this.expect(b, ['payment_pending'], 'pay');
    if (b.paymentStatus === 'paid') throw new ValidationError('This booking is already paid');
    const due = this.dueOf(b);
    if (due <= 0) throw new ValidationError('Nothing to pay');
    const order = await this.payments.createOrder(due, userId, `quote_${b.id.slice(0, 8)}_${Date.now()}`);
    await this.prisma.payment.create({
      data: { bookingId: b.id, userId, kind: 'quote', method: 'online', amount: due, razorpayOrderId: order.orderId },
    });
    return { ...order, rupees: due };
  }

  async verifyQuotePayment(bookingId: string, userId: string, body: any) {
    const b = await this.loadForCustomer(bookingId, userId);
    this.expect(b, ['payment_pending'], 'confirm payment');
    const { orderId, paymentId, signature } = body ?? {};
    const payment = await this.prisma.payment.findFirst({ where: { razorpayOrderId: String(orderId), bookingId: b.id, kind: 'quote' } });
    if (!payment) throw new ValidationError('Unknown payment order');
    this.payments.verify(orderId, paymentId, signature);

    await this.prisma.$transaction([
      this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'paid', razorpayPaymentId: String(paymentId), paidAt: new Date() } }),
      this.prisma.booking.update({
        where: { id: b.id },
        data: { paymentMethod: 'online', paymentStatus: 'paid', razorpayOrderId: String(orderId), razorpayPaymentId: String(paymentId) },
      }),
    ]);
    await this.notifyProvider(b, 'payment_received', `Payment received ₹${payment.amount}`, `${b.user.name ?? 'The customer'} paid online. You can start work.`);
    return this.customerQuoteView(await this.load(b.id));
  }

  async chooseCash(bookingId: string, userId: string) {
    const b = await this.loadForCustomer(bookingId, userId);
    this.expect(b, ['payment_pending'], 'choose cash');
    if (b.paymentStatus === 'paid') throw new ValidationError('This booking is already paid');
    await this.prisma.booking.update({ where: { id: b.id }, data: { paymentMethod: 'cash' } });
    await this.notifyProvider(b, 'collect_cash', `Collect ₹${this.dueOf(b)} in cash`, `${b.user.name ?? 'The customer'} will pay you in cash. Confirm once you have it.`);
    return this.customerQuoteView(await this.load(b.id));
  }

  async confirmCash(bookingId: string, providerId: string) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['payment_pending'], 'confirm cash');
    if (b.paymentStatus === 'paid') throw new ValidationError('Payment is already confirmed');
    const due = this.dueOf(b);
    await this.prisma.$transaction([
      this.prisma.payment.create({ data: { bookingId: b.id, userId: b.userId, kind: 'quote', method: 'cash', amount: due, status: 'paid', paidAt: new Date() } }),
      this.prisma.booking.update({ where: { id: b.id }, data: { paymentMethod: 'cash', paymentStatus: 'paid', cashConfirmedAt: new Date() } }),
    ]);
    await this.notifyCustomer(b, 'payment_confirmed', 'Payment confirmed', `${this.proName(b)} confirmed your cash payment of ₹${due}.`);
    return this.providerView(await this.load(b.id));
  }

  // ---------- Work ----------

  async startWork(bookingId: string, providerId: string) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['payment_pending'], 'start work');
    if (b.paymentStatus !== 'paid') throw new ValidationError('Collect payment before starting work');
    await this.prisma.booking.update({ where: { id: b.id }, data: { status: 'in_progress', startedAt: new Date() } });
    const count = b.items.filter((i) => i.status === 'accepted').length;
    await this.notifyCustomer(b, 'work_started', `${this.proName(b)} has started working`, `${count} ${count === 1 ? 'task' : 'tasks'} in progress.`);
    return this.providerView(await this.load(b.id));
  }

  async setItemDone(bookingId: string, providerId: string, itemId: string, done: unknown) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['in_progress'], 'update tasks');
    const item = b.items.find((i) => i.id === itemId && i.status === 'accepted');
    if (!item) throw new NotFoundError('Task not found');
    await this.prisma.bookingItem.update({ where: { id: item.id }, data: { done: done !== false } });
    return this.providerView(await this.load(b.id));
  }

  async complete(bookingId: string, providerId: string) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['in_progress'], 'complete the job');
    const open = b.items.filter((i) => i.status === 'accepted' && !i.done);
    if (open.length) throw new ValidationError(`Mark every task done first (${open.length} left)`);

    const pct = b.serviceProvider?.commission ?? 10;
    const agreedTotal = b.agreedTotal ?? b.finalPrice;
    const { commissionAmount, providerEarning } = earnings(agreedTotal, pct, b.tip);
    await this.prisma.booking.update({
      where: { id: b.id },
      data: { status: 'completed', completedAt: new Date(), commissionPct: pct, commissionAmount, providerEarning },
    });
    await this.notifyCustomer(b, 'job_completed', 'Your service is complete', `How did ${this.proName(b)} do? Rate the service.`, { action: 'rate' });
    logger.info('Job completed', { bookingId: b.id, providerId, agreedTotal, commissionAmount });
    return this.providerView(await this.load(b.id));
  }

  /** Professional backs out before the visit starts. The booking goes back to matching. */
  async cancelByProvider(bookingId: string, providerId: string, reason?: unknown) {
    const b = await this.loadForProvider(bookingId, providerId);
    this.expect(b, ['accepted', 'on_the_way'], 'cancel');
    await this.assignments.release(b.id, providerId, typeof reason === 'string' ? reason : undefined);
    await this.notifyCustomer(
      b,
      'reassigning',
      'Finding another professional',
      `${this.proName(b)} could not make it. We are assigning someone new for the same slot.`,
    );
    return { released: true };
  }

  /** Jobs this professional holds that aren't finished. */
  activeJobsWhere(providerId: string): Prisma.BookingWhereInput {
    return { serviceProviderId: providerId, status: { in: ACTIVE_WITH_PRO as any } };
  }
}
