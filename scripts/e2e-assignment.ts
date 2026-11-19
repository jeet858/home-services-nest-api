/**
 * End-to-end check of automatic assignment against a running API and a LOCAL database:
 * radius limit, missing coordinates, slot buffer, scoring, concurrent sweeps, cooldown after a
 * timed-out offer, escalation to the admin team, the location heartbeat, the cron endpoint and
 * place search.
 *
 *   API: NODE_ENV=development PAYMENT_MOCK=true OTP_DEV_ECHO=true CRON_SECRET=e2e DATABASE_URL=<local> npm start
 *   E2E_BASE_URL=http://localhost:5055 CRON_SECRET=e2e DATABASE_URL=<local> npx tsx scripts/e2e-assignment.ts
 *
 * Set E2E_SKIP_GEO=1 to skip the place-search checks (they call the public Photon service).
 * Refuses to run unless DATABASE_URL points at localhost, because it seeds and rewrites rows.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { ASSIGNMENT } from '../src/assignment/assignment.config';
import { pickRing, scoreCandidate, slotClashes } from '../src/assignment/assignment.scoring';

const DB = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error('Refusing to run: DATABASE_URL must point at a local database.');
  process.exit(1);
}
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5055';
const CRON = process.env.CRON_SECRET ?? '';
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
const north = (km: number) => ({ lat: KOLKATA.lat + km / 111, lng: KOLKATA.lng });
const DATE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const SLOT = '10:00';

// name -> [phone suffix, km from the customer (null = no location), rating, reviews]
const PROS = {
  near: [201, 2, 4.8, 40],
  busy: [202, 2.2, 4.8, 40], // same quality as `near`, but already has a job later that day
  clash: [203, 0.5, 5, 80], // closest and best rated, but booked an hour after the slot
  far: [204, 30, 5, 80], // outside the last ring
  lost: [205, null, 5, 80], // never shared a location
} as const;
type ProName = keyof typeof PROS;

async function seed() {
  await prisma.notification.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.serviceProvider.deleteMany({ where: { email: { endsWith: '@e2e.test' } } });
  await prisma.service.deleteMany({ where: { name: 'E2E AC Repair' } });
  await prisma.user.deleteMany({ where: { phoneNumber: { in: [phone(1), phone(2)] } } });

  const service = await prisma.service.create({
    data: {
      name: 'E2E AC Repair',
      originalPrice: 699,
      discountedPrice: 599,
      duration: '1 hr',
      subservices: { create: [{ name: 'AC Service (Split)', originalPrice: 699, discountedPrice: 599, duration: '1 hr' }] },
    },
    include: { subservices: true },
  });

  const user = await prisma.user.create({ data: { phoneNumber: phone(1), name: 'Ananya Sen', password: 'Not Required' } });
  const address = await prisma.address.create({
    data: { userId: user.id, street: 'Sector V, Salt Lake', city: 'Kolkata', state: 'WB', zip: '700091', country: 'India', ...KOLKATA },
  });
  const stranger = await prisma.user.create({ data: { phoneNumber: phone(2), name: 'Someone Else', password: 'Not Required' } });
  const strangerAddress = await prisma.address.create({
    data: { userId: stranger.id, street: 'Park Street', city: 'Kolkata', state: 'WB', zip: '700016', country: 'India', ...north(1) },
  });

  const pros = {} as Record<ProName, { id: string }>;
  for (const [name, [n, , rating, reviews]] of Object.entries(PROS) as [ProName, (typeof PROS)[ProName]][]) {
    pros[name] = await prisma.serviceProvider.create({
      data: {
        name: `Pro ${name}`,
        email: `${name}@e2e.test`,
        phoneNumber: phone(n),
        status: 'active',
        availability: {},
        commission: 10,
        ratingAverage: rating,
        ratingTotal: reviews,
        services: { connect: [{ id: service.id }] },
      },
    });
  }

  // Existing jobs on the booking day: `busy` at 13:00 (clear of the slot), `clash` at 11:00 (inside the buffer).
  for (const [name, time] of [['busy', '13:00'], ['clash', '11:00']] as const) {
    await prisma.booking.create({
      data: { userId: stranger.id, addressId: strangerAddress.id, serviceProviderId: pros[name].id, date: new Date(DATE), time, status: 'accepted', finalPrice: 599 },
    });
  }
  return { sub: service.subservices[0], user, address, strangerAddress, pros };
}

async function customerLogin() {
  const sent = await call('POST', '/api/auth/user/send-otp', undefined, { phoneNumber: phone(1) });
  assert.ok(sent.devOtp, 'OTP_DEV_ECHO must be on for the API under test');
  return (await call('POST', '/api/auth/user/verify-otp', undefined, { phoneNumber: phone(1), otp: sent.devOtp })).token as string;
}

async function partnerLogin(name: ProName) {
  const phoneNumber = phone(PROS[name][0]);
  const sent = await call('POST', '/api/partner/auth/send-otp', undefined, { phoneNumber });
  return (await call('POST', '/api/partner/auth/verify-otp', undefined, { phoneNumber, otp: sent.data.devOtp })).data.token as string;
}

async function book(cust: string, addressId: string, subserviceId: string, expectStatus?: number) {
  const order = await call('POST', '/api/payments/order', cust, { kind: 'visit' });
  return call(
    'POST',
    '/api/booking',
    cust,
    {
      items: [{ subserviceId, qty: 1 }],
      addressId,
      date: DATE,
      time: SLOT,
      razorpayOrderId: order.data.orderId,
      razorpayPaymentId: `pay_mock_${Date.now()}`,
      razorpaySignature: 'mock',
    },
    expectStatus,
  );
}

const cron = () => call('GET', '/api/cron/assignments', CRON);
const openOffers = (bookingId: string) => prisma.bookingAssignment.findMany({ where: { bookingId, status: 'offered' } });
const lapse = (id: string) => prisma.bookingAssignment.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

function scoringChecks() {
  assert.equal(pickRing([7, 12]), 10);
  assert.equal(pickRing([2, 12]), 5);
  assert.equal(pickRing([25]), null);
  assert.equal(pickRing([]), null);
  assert.equal(slotClashes('10:00', ['11:00']), true);
  assert.equal(slotClashes('10:00', ['11:30']), false);
  assert.equal(slotClashes('10:00', ['08:31']), true);
  assert.equal(slotClashes('10:00', []), false);
  const base = { km: 2, ratingAverage: 4.5, ratingCount: 30, accepted: 8, declined: 2, jobsThatDay: 0, hoursSinceLastOffer: 5 };
  const s = (o: Partial<typeof base>) => scoreCandidate({ ...base, ...o }, 5).score;
  assert.ok(s({}) > s({ km: 4 }), 'closer scores higher');
  assert.ok(s({}) > s({ ratingAverage: 3 }), 'better rated scores higher');
  assert.ok(s({}) > s({ accepted: 2, declined: 8 }), 'more reliable scores higher');
  assert.ok(s({}) > s({ jobsThatDay: 3 }), 'less loaded scores higher');
  assert.ok(s({ hoursSinceLastOffer: 20 }) > s({}), 'longer idle scores higher');
  // One 5-star review must not outrank a long 4.7 record.
  assert.ok(s({ ratingAverage: 4.7, ratingCount: 200 }) > s({ ratingAverage: 5, ratingCount: 1 }));
  const w = ASSIGNMENT.weights;
  assert.ok(Math.abs(w.distance + w.rating + w.acceptance + w.workload + w.fairness - 1) < 1e-9, 'weights add up to 1');
  const best = scoreCandidate({ ...base, km: 0, ratingAverage: 5, ratingCount: 1e6, accepted: 1e6, declined: 0, hoursSinceLastOffer: null }, 5).score;
  assert.ok(best > 0.99 && best <= 1);
  ok('scoring maths: rings, slot buffer, each factor moves the score the right way');
}

async function geoChecks(cust: string) {
  if (process.env.E2E_SKIP_GEO) return ok('place search skipped (E2E_SKIP_GEO)');
  await call('GET', '/api/geo/search?q=ab', cust, undefined, 400);
  await call('GET', '/api/geo/search?q=Siliguri', undefined, undefined, 401);
  const places = (await call('GET', '/api/geo/search?q=Siliguri', cust)).data.places as any[];
  assert.ok(places.length > 0, 'Siliguri should be found');
  const top = places[0];
  assert.ok(Math.abs(top.lat - 26.72) < 0.3 && Math.abs(top.lng - 88.43) < 0.3, `Siliguri is at ~26.72, 88.43, got ${top.lat}, ${top.lng}`);
  for (const key of ['title', 'subtitle', 'street', 'city', 'state', 'zip']) assert.equal(typeof top[key], 'string', key);
  assert.match(top.state, /West Bengal/i);
  await call('GET', '/api/geo/reverse?lat=95&lng=88', cust, undefined, 400);
  const place = (await call('GET', `/api/geo/reverse?lat=${KOLKATA.lat}&lng=${KOLKATA.lng}`, cust)).data.place;
  assert.ok(place && /Kolkata/i.test(`${place.city} ${place.subtitle}`), `reverse geocode of central Kolkata: ${JSON.stringify(place)}`);
  ok(`place search: "Siliguri" -> ${top.title}, ${top.subtitle}; reverse geocode of the pin -> ${place.city}`);
}

async function main() {
  console.log(`E2E (assignment) against ${BASE}`);
  assert.ok(CRON, 'Set CRON_SECRET (same value as the API under test)');
  scoringChecks();

  const { sub, address, strangerAddress, pros } = await seed();
  const cust = await customerLogin();
  const tokens = {} as Record<ProName, string>;
  for (const name of Object.keys(PROS) as ProName[]) {
    tokens[name] = await partnerLogin(name);
    const km = PROS[name][1];
    await call('PATCH', '/api/partner/me/online', tokens[name], { online: true, ...(km === null ? {} : north(km)) });
  }
  ok('seeded 5 professionals: near, busy, slot clash, 30 km away, no location; all online');

  await book(cust, strangerAddress.id, sub.id, 404);
  ok('booking with another customer\'s address is refused');

  // ---- Who gets the first offer ----
  const id = (await book(cust, address.id, sub.id)).data.booking.id as string;
  let offers = await openOffers(id);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].providerId, pros.near.id, 'the closest free professional is offered first, not the one with a clashing job');
  assert.ok(Math.abs(offers[0].distanceKm! - 2) < 0.2, `distance recorded: ${offers[0].distanceKm}`);
  assert.ok(offers[0].score! > 0 && offers[0].score! <= 1, `score recorded: ${offers[0].score}`);
  for (const name of ['clash', 'far', 'lost', 'busy'] as const) {
    assert.equal((await call('GET', '/api/partner/offers/current', tokens[name])).data.offer, null, `${name} must not hold an offer`);
  }
  ok(`first offer -> near pro (2 km, score ${offers[0].score}); slot-clash pro skipped although closest and best rated`);

  // ---- Concurrent sweeps must leave exactly one open offer ----
  await call('GET', '/api/cron/assignments', undefined, undefined, 401);
  await call('GET', '/api/cron/assignments', 'wrong', undefined, 401);
  await lapse(offers[0].id);
  await Promise.all([
    cron(),
    cron(),
    call('GET', `/api/booking/my-bookings/${id}`, cust),
    call('GET', `/api/booking/my-bookings/${id}`, cust),
    call('GET', '/api/partner/offers/current', tokens.near),
    call('GET', '/api/partner/offers/current', tokens.busy),
    call('PATCH', '/api/partner/me/online', tokens.busy, { online: true, ...north(2.2) }),
  ]);
  offers = await openOffers(id);
  assert.equal(offers.length, 1, `exactly one open offer after concurrent sweeps, got ${offers.length}`);
  assert.equal(offers[0].providerId, pros.busy.id, 'the busier professional is next');
  const all = await prisma.bookingAssignment.findMany({ where: { bookingId: id } });
  assert.equal(all.length, 2, `two offers in total (one expired, one open), got ${all.length}`);
  ok('offer expired; 7 concurrent sweeps/polls produced exactly one new offer -> busy pro; cron needs its secret');

  // ---- Nobody left in range: escalate ----
  await call('POST', `/api/partner/offers/${offers[0].id}/reject`, tokens.busy, { reason: 'Not available' });
  let b = await prisma.booking.findUniqueOrThrow({ where: { id } });
  assert.equal(b.status, 'searching');
  assert.ok(b.matchEscalatedAt, 'booking is flagged for manual assignment once nobody in range is left');
  assert.equal((await openOffers(id)).length, 0, 'the 30 km and no-location professionals are never offered');
  const note = await prisma.notification.findFirst({ where: { bookingId: id, type: 'reassigning' } });
  assert.ok(note, 'customer is told the search is taking longer');
  const before = b.matchEscalatedAt!.getTime();
  await cron();
  b = await prisma.booking.findUniqueOrThrow({ where: { id } });
  assert.equal(b.matchEscalatedAt!.getTime(), before, 'escalation happens once');
  assert.equal(await prisma.notification.count({ where: { bookingId: id, type: 'reassigning' } }), 1);
  ok('rejected; 30 km and no-location pros never offered; booking escalated once and customer notified');

  // ---- Location heartbeat brings a professional into range ----
  await call('PATCH', '/api/partner/me/location', tokens.far, { lat: 123, lng: 88 }, 400);
  await call('PATCH', '/api/partner/me/location', tokens.far, {}, 400);
  await call('PATCH', '/api/partner/me/location', tokens.far, north(8));
  await cron();
  offers = await openOffers(id);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].providerId, pros.far.id);
  assert.ok(Math.abs(offers[0].distanceKm! - 8) < 0.3);
  const shown = (await call('GET', '/api/partner/offers/current', tokens.far)).data.offer;
  assert.equal(shown.booking.id, id);
  ok('far pro reported a new position 8 km away; the next cron run offered them the waiting booking (10 km ring)');

  // ---- Timed-out professional comes back only after the cooldown ----
  await lapse(offers[0].id);
  await cron();
  assert.equal((await openOffers(id)).length, 0, 'near pro timed out moments ago: still cooling down');
  const expired = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId: id, providerId: pros.near.id } });
  await prisma.bookingAssignment.update({
    where: { id: expired.id },
    data: { respondedAt: new Date(Date.now() - (ASSIGNMENT.expiredRetryCooldownMin + 1) * 60 * 1000) },
  });
  await cron();
  offers = await openOffers(id);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].providerId, pros.near.id, 'after the cooldown the timed-out professional is offered again');
  const rejectedAgain = await prisma.bookingAssignment.count({ where: { bookingId: id, providerId: pros.busy.id } });
  assert.equal(rejectedAgain, 1, 'a professional who rejected is never offered the same booking again');
  ok('timed-out pro re-offered only after the cooldown; the pro who rejected is never asked again');

  // ---- Accept clears the flag ----
  const accepted = (await call('POST', `/api/partner/offers/${offers[0].id}/accept`, tokens.near)).data;
  assert.equal(accepted.status, 'accepted');
  b = await prisma.booking.findUniqueOrThrow({ where: { id } });
  assert.equal(b.serviceProviderId, pros.near.id);
  assert.equal(b.matchEscalatedAt, null);
  ok('accepted: booking assigned and the manual-assignment flag cleared');

  // ---- A second booking in the same slot skips the professional who just took the first ----
  const id2 = (await book(cust, address.id, sub.id)).data.booking.id as string;
  offers = await openOffers(id2);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].providerId, pros.busy.id, 'near pro now has a job in that slot');
  ok('second booking in the same slot went to the next professional, not the one already booked');

  await geoChecks(cust);

  console.log(`\nAll ${step} steps passed.`);
}

main()
  .catch((e) => {
    console.error('\nFAILED:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
