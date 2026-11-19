/**
 * End-to-end check of the partner flow against a running API and a LOCAL database:
 * visit-charge booking -> auto-assign (expiry, reject, accept) -> trip -> service OTP ->
 * quote with extra tasks -> 3-round negotiation -> cash payment -> work -> completion -> earnings,
 * then a second booking paid online.
 *
 *   API: NODE_ENV=development PAYMENT_MOCK=true OTP_DEV_ECHO=true DATABASE_URL=<local> npm start
 *   E2E_BASE_URL=http://localhost:5055 DATABASE_URL=<local> npx tsx scripts/e2e-quote-flow.ts
 *
 * Refuses to run unless DATABASE_URL points at localhost, because it seeds and rewrites rows.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const DB = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error('Refusing to run: DATABASE_URL must point at a local database.');
  process.exit(1);
}
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5055';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB }) });

let step = 0;
const ok = (msg: string) => console.log(`  ✓ ${String(++step).padStart(2, '0')} ${msg}`);

async function call(method: string, path: string, token?: string, body?: unknown, expectStatus?: number) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (expectStatus !== undefined) {
    assert.equal(res.status, expectStatus, `${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  } else if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

const phone = (n: number) => `9${String(n).padStart(9, '0')}`;
const KOLKATA = { lat: 22.5726, lng: 88.3639 };

async function seed() {
  // Clean slate for the rows this script owns.
  await prisma.notification.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.serviceProvider.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
  await prisma.service.deleteMany({ where: { name: 'E2E AC Repair' } });
  await prisma.user.deleteMany({ where: { phoneNumber: phone(1) } });

  const service = await prisma.service.create({
    data: {
      name: 'E2E AC Repair',
      originalPrice: 699,
      discountedPrice: 599,
      duration: '1 hr',
      subservices: {
        create: [
          { name: 'AC Service (Split)', originalPrice: 699, discountedPrice: 599, duration: '1 hr' },
          { name: 'Gas Refill', originalPrice: 2999, discountedPrice: 2499, duration: '1 hr' },
          { name: 'Capacitor replacement', originalPrice: 499, discountedPrice: 450, duration: '30 mins' },
        ],
      },
    },
    include: { subservices: true },
  });
  const sub = Object.fromEntries(service.subservices.map((s) => [s.name, s]));

  const user = await prisma.user.create({ data: { phoneNumber: phone(1), name: 'Ananya Sen', password: 'Not Required' } });
  const address = await prisma.address.create({
    data: { userId: user.id, street: 'Sector V, Salt Lake', city: 'Kolkata', state: 'WB', zip: '700091', country: 'India', ...KOLKATA },
  });

  // Three active professionals at increasing distance from the customer.
  const pros = [];
  for (const [i, km] of [[1, 1], [2, 3], [3, 6]] as const) {
    pros.push(
      await prisma.serviceProvider.create({
        data: {
          name: ['Rakesh Das', 'Sourav Pal', 'Imran Ali'][i - 1],
          email: `pro${i}@e2e.test`,
          phoneNumber: phone(100 + i),
          status: 'active',
          availability: {},
          commission: 10,
          lat: KOLKATA.lat + km / 111,
          lng: KOLKATA.lng,
          services: { connect: [{ id: service.id }] },
        },
      }),
    );
  }
  return { service, sub, user, address, pros };
}

async function customerLogin() {
  const sent = await call('POST', '/api/auth/user/send-otp', undefined, { phoneNumber: phone(1) });
  assert.ok(sent.devOtp, 'OTP_DEV_ECHO must be on for the API under test');
  await call('POST', '/api/auth/user/verify-otp', undefined, { phoneNumber: phone(1), otp: '0000' }, 400);
  const v = await call('POST', '/api/auth/user/verify-otp', undefined, { phoneNumber: phone(1), otp: sent.devOtp });
  return v.token as string;
}

async function partnerLogin(n: number) {
  await call('POST', '/api/partner/auth/send-otp', undefined, { phoneNumber: phone(999) }, 400);
  const sent = await call('POST', '/api/partner/auth/send-otp', undefined, { phoneNumber: phone(100 + n) });
  const v = await call('POST', '/api/partner/auth/verify-otp', undefined, { phoneNumber: phone(100 + n), otp: sent.data.devOtp });
  return v.data.token as string;
}

async function book(cust: string, addressId: string, items: { subserviceId: string; qty: number }[]) {
  const order = await call('POST', '/api/payments/order', cust, { kind: 'visit' });
  assert.equal(order.data.rupees, 99);
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await call('POST', '/api/booking', cust, {
    items,
    addressId,
    date,
    time: '10:00',
    razorpayOrderId: order.data.orderId,
    razorpayPaymentId: `pay_mock_${Date.now()}`,
    razorpaySignature: 'mock',
  });
  return res.data.booking.id as string;
}

async function main() {
  console.log(`E2E against ${BASE}`);
  const { sub, address, pros } = await seed();
  ok('seeded service, customer and 3 professionals');

  const cust = await customerLogin();
  // A provider token must not open customer routes, and vice versa.
  const [p1, p2, p3] = [await partnerLogin(1), await partnerLogin(2), await partnerLogin(3)];
  await call('GET', '/api/booking/my-bookings', p1, undefined, 401);
  await call('GET', '/api/partner/me', cust, undefined, 401);
  ok('customer + partner OTP login; wrong OTP and unregistered number rejected; tokens not interchangeable');

  for (const [t, i] of [[p1, 0], [p2, 1], [p3, 2]] as const) {
    await call('PATCH', '/api/partner/me/online', t, { online: true, lat: pros[i].lat, lng: pros[i].lng });
  }
  ok('all three professionals online');

  // ---- Booking 1: cash path with negotiation ----
  const id = await book(cust, address.id, [
    { subserviceId: sub['AC Service (Split)'].id, qty: 1 },
    { subserviceId: sub['Gas Refill'].id, qty: 1 },
  ]);
  let b = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { items: true, payments: true } });
  assert.equal(b.status, 'offered');
  assert.equal(b.estimatedTotal, 599 + 2499);
  assert.equal(b.visitChargePaid, true);
  assert.equal(b.payments[0].status, 'paid');
  ok(`booked with ₹99 visit charge, estimate ₹${b.estimatedTotal}, offered automatically`);

  // Nearest professional gets it first; let it lapse.
  const o1 = (await call('GET', '/api/partner/offers/current', p1)).data.offer;
  assert.equal(o1.booking.id, id);
  assert.equal((await call('GET', '/api/partner/offers/current', p2)).data.offer, null);
  await prisma.bookingAssignment.update({ where: { id: o1.assignmentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('GET', '/api/partner/offers/current', p1)).data.offer, null);
  await call('POST', `/api/partner/offers/${o1.assignmentId}/accept`, p1, undefined, 400);
  ok('nearest pro offered first; offer expired lazily and late accept refused');

  const cb = (await call('GET', `/api/booking/my-bookings/${id}`, cust)).data.booking;
  assert.equal(cb.reassigning, true);
  const o2 = (await call('GET', '/api/partner/offers/current', p2)).data.offer;
  assert.ok(o2, 'second-nearest pro should hold the offer');
  await call('POST', `/api/partner/offers/${o2.assignmentId}/reject`, p2, { reason: 'Too far from my location' });
  ok('reassigned to next pro (customer sees reassigning); rejected with reason');

  const o3 = (await call('GET', '/api/partner/offers/current', p3)).data.offer;
  assert.ok(o3 && o3.booking.estimatedEarning > 0);
  const accepted = (await call('POST', `/api/partner/offers/${o3.assignmentId}/accept`, p3)).data;
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.serviceOtp, undefined, 'service OTP must never reach the professional');
  ok('third pro accepted; OTP hidden from the pro');

  await call('POST', `/api/partner/jobs/${id}/verify-otp`, p3, { otp: '0000' }, 400);
  await call('POST', `/api/partner/jobs/${id}/start-trip`, p3);
  await call('POST', `/api/partner/jobs/${id}/arrived`, p3);
  const wrong = await call('POST', `/api/partner/jobs/${id}/verify-otp`, p3, { otp: 'xxxx' }, 400);
  assert.match(wrong.message, /2 attempts left/);
  const otp = (await call('GET', `/api/booking/my-bookings/${id}`, cust)).data.booking.serviceOtp;
  assert.equal((await call('POST', `/api/partner/jobs/${id}/verify-otp`, p3, { otp })).data.status, 'inspecting');
  ok('trip -> arrived -> wrong OTP ("2 attempts left") -> correct OTP -> inspecting');

  const cat = (await call('GET', `/api/partner/jobs/${id}/catalogue`, p3)).data.subservices;
  assert.ok(cat.some((s: any) => s.name === 'Capacitor replacement'));
  const job = (await call('GET', `/api/partner/jobs/${id}`, p3)).data;
  const ac = job.items.find((i: any) => i.name.startsWith('AC Service'));
  const gas = job.items.find((i: any) => i.name === 'Gas Refill');
  const quote = (
    await call('PUT', `/api/partner/jobs/${id}/quote`, p3, {
      items: [
        { id: ac.id, qty: 1, price: 699, reason: 'Higher complexity' },
        { id: gas.id, qty: 1, price: 2499 },
      ],
      additional: [
        { subserviceId: sub['Capacitor replacement'].id, qty: 1, price: 450 },
        { name: 'Copper pipe extension (per ft)', description: 'Extend the line to the new outdoor unit', qty: 3, price: 150 },
      ],
      note: 'Outdoor unit needs a new capacitor.',
    })
  ).data;
  assert.equal(quote.status, 'quote_sent');
  assert.equal(quote.items.length, 4);
  ok('quote sent: 1 price change with reason, 2 additional tasks (catalogue + custom)');

  let q = (await call('GET', `/api/booking/my-bookings/${id}/quote`, cust)).data;
  const byName = (n: string) => q.items.find((i: any) => i.name.startsWith(n));
  assert.deepEqual(byName('AC Service').actions, ['accept', 'reject', 'counter']);
  assert.equal(q.totals.revised, 699 + 2499 + 450 + 450);
  await call('POST', `/api/booking/my-bookings/${id}/quote/respond`, cust, { items: [{ id: byName('Capacitor').id, action: 'counter', price: 500 }] }, 400);
  q = (
    await call('POST', `/api/booking/my-bookings/${id}/quote/respond`, cust, {
      items: [
        { id: byName('AC Service').id, action: 'accept' },
        { id: byName('Gas Refill').id, action: 'reject' },
        { id: byName('Capacitor').id, action: 'counter', price: 350, note: 'Can you do 350?' },
        { id: byName('Copper pipe').id, action: 'counter', price: 100 },
      ],
    })
  ).data;
  assert.equal(q.status, 'quote_sent');
  ok('customer: accept 1, reject 1, counter 2 (counter above offer refused)');

  const cap = () => q.items.find((i: any) => i.name.startsWith('Capacitor'));
  const pipe = () => q.items.find((i: any) => i.name.startsWith('Copper pipe'));
  let pj = (await call('POST', `/api/partner/jobs/${id}/items/${cap().id}/respond`, p3, { action: 'accept' })).data;
  await call('POST', `/api/partner/jobs/${id}/items/${pipe().id}/respond`, p3, { action: 'counter', price: 160 }, 400);
  pj = (await call('POST', `/api/partner/jobs/${id}/items/${pipe().id}/respond`, p3, { action: 'counter', price: 130, note: 'Material cost' })).data;
  assert.equal(pj.quoteRound, 2);
  ok('pro: accepted ₹350 capacitor; countered pipe at ₹130 (round 2; out-of-range counter refused)');

  q = (await call('GET', `/api/booking/my-bookings/${id}/quote`, cust)).data;
  assert.deepEqual(pipe().actions, ['accept', 'reject', 'counter']);
  q = (await call('POST', `/api/booking/my-bookings/${id}/quote/respond`, cust, { items: [{ id: pipe().id, action: 'counter', price: 120 }] })).data;
  assert.equal(pipe().round, 3);
  pj = (await call('GET', `/api/partner/jobs/${id}`, p3)).data;
  assert.deepEqual(pj.items.find((i: any) => i.id === pipe().id).actions, ['accept', 'decline']);
  await call('POST', `/api/partner/jobs/${id}/items/${pipe().id}/respond`, p3, { action: 'counter', price: 125 }, 400);
  ok('customer final round 3 at ₹120; pro limited to accept/decline (counter refused)');

  pj = (await call('POST', `/api/partner/jobs/${id}/items/${pipe().id}/respond`, p3, { action: 'accept' })).data;
  const agreed = 699 + 350 + 120 * 3;
  assert.equal(pj.status, 'payment_pending');
  assert.equal(pj.totals.agreedTotal, agreed);
  assert.equal(pj.totals.due, agreed - 99);
  ok(`settled: agreed ₹${agreed}, due ₹${agreed - 99} after the visit charge`);

  await call('POST', `/api/partner/jobs/${id}/start-work`, p3, undefined, 400);
  await call('POST', `/api/booking/my-bookings/${id}/pay/cash`, cust);
  pj = (await call('POST', `/api/partner/jobs/${id}/confirm-cash`, p3)).data;
  assert.equal(pj.paymentStatus, 'paid');
  pj = (await call('POST', `/api/partner/jobs/${id}/start-work`, p3)).data;
  assert.equal(pj.status, 'in_progress');
  ok('start-work blocked until paid; customer chose cash; pro confirmed cash; work started');

  await call('POST', `/api/partner/jobs/${id}/complete`, p3, undefined, 400);
  for (const it of pj.items.filter((i: any) => i.status === 'accepted')) {
    await call('PATCH', `/api/partner/jobs/${id}/items/${it.id}/done`, p3, { done: true });
  }
  pj = (await call('POST', `/api/partner/jobs/${id}/complete`, p3)).data;
  assert.equal(pj.status, 'completed');
  b = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { items: true, payments: true } });
  assert.equal(b.commissionAmount, Math.round(agreed * 10) / 100);
  assert.equal(b.providerEarning, agreed - b.commissionAmount!);
  ok(`completed: commission ₹${b.commissionAmount}, pro earns ₹${b.providerEarning}`);

  const earn = (await call('GET', '/api/partner/earnings?period=week', p3)).data;
  assert.equal(earn.total, b.providerEarning);
  assert.equal(earn.cashCollected, agreed - 99);
  assert.equal(earn.commissionDue, b.commissionAmount);
  ok(`earnings: ₹${earn.total} this week, cash ₹${earn.cashCollected}, next payout ₹${earn.nextPayout.amount}`);

  // ---- Booking 2: online path, accept-all ----
  const id2 = await book(cust, address.id, [{ subserviceId: sub['AC Service (Split)'].id, qty: 2 }]);
  const o = (await call('GET', '/api/partner/offers/current', p1)).data.offer;
  assert.equal(o.booking.id, id2);
  await call('POST', `/api/partner/offers/${o.assignmentId}/accept`, p1);
  await call('POST', `/api/partner/jobs/${id2}/arrived`, p1);
  const otp2 = (await call('GET', `/api/booking/my-bookings/${id2}`, cust)).data.booking.serviceOtp;
  await call('POST', `/api/partner/jobs/${id2}/verify-otp`, p1, { otp: otp2 });
  await call('PUT', `/api/partner/jobs/${id2}/quote`, p1, {});
  q = (await call('POST', `/api/booking/my-bookings/${id2}/quote/respond`, cust, { acceptAll: true })).data;
  assert.equal(q.status, 'payment_pending');
  const order = (await call('POST', `/api/booking/my-bookings/${id2}/pay/order`, cust)).data;
  assert.equal(order.rupees, 599 * 2 - 99);
  await call('POST', `/api/booking/my-bookings/${id2}/pay/verify`, cust, { orderId: order.orderId, paymentId: 'pay_mock_x', signature: 'bad' }, 400);
  q = (await call('POST', `/api/booking/my-bookings/${id2}/pay/verify`, cust, { orderId: order.orderId, paymentId: 'pay_mock_x', signature: 'mock' })).data;
  assert.equal(q.paymentStatus, 'paid');
  ok('booking 2: accept-all, online order for ₹1,099, bad signature refused, paid');

  // ---- Inboxes ----
  const ci = (await call('GET', '/api/notifications', cust)).data;
  const types = new Set(ci.notifications.map((n: any) => n.type));
  for (const t of ['pro_assigned', 'pro_on_the_way', 'pro_arrived', 'inspection_started', 'quote_ready', 'quote_updated', 'quote_agreed', 'payment_confirmed', 'work_started', 'job_completed']) {
    assert.ok(types.has(t), `customer inbox missing ${t}`);
  }
  assert.ok(ci.unread > 0);
  assert.equal((await call('POST', '/api/notifications/read', cust, {})).data.unread, 0);
  const pi = (await call('GET', '/api/partner/notifications', p3)).data;
  const ptypes = new Set(pi.notifications.map((n: any) => n.type));
  for (const t of ['booking_offered', 'quote_countered', 'quote_approved', 'collect_cash']) assert.ok(ptypes.has(t), `partner inbox missing ${t}`);
  ok(`inboxes: customer ${ci.notifications.length} notices, partner ${pi.notifications.length}; mark-all-read works`);

  const dash = (await call('GET', '/api/partner/dashboard', p3)).data;
  assert.equal(dash.todayEarnings, b.providerEarning);
  const jobs = (await call('GET', '/api/partner/jobs?tab=cancelled', p2)).data;
  assert.ok(jobs.jobs.some((j: any) => j.status === 'rejected_by_you'));
  ok('dashboard shows today’s earnings; rejected offer listed as "Rejected by you"');

  console.log(`\nAll ${step} checks passed.`);
}

main()
  .catch((e) => {
    console.error('\n✗ FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
