/**
 * Seeds demo data for testing the app and admin panel: services and subservices with
 * images, coupons, service providers with photos, bookings in every status, and ratings.
 *
 *   npm run seed:demo          # (re)create the demo data
 *   npm run seed:demo:clean    # remove it
 *
 * Images are downloaded from Unsplash and uploaded to the Supabase bucket under seed/.
 * No users are created: bookings go to the first existing client and providers are
 * created by the first existing admin. Safe to re-run: previous demo rows are replaced.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { STORAGE_BUCKET, supabase } from '../src/storage/storage.client';
import { COUPONS } from './seed-coupons';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const SEED_PREFIX = 'seed';
const SEED_NOTE = '[seed]';
const PROVIDER_EMAIL_DOMAIN = '@subidha.test';
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&q=80&fm=jpg&fit=crop`;

type SubSeed = { name: string; description: string; process: string; image: string; originalPrice: number; discountedPrice: number; duration: string };
type ServiceSeed = Omit<SubSeed, 'name'> & { name: string; subservices: SubSeed[] };

const SERVICES: ServiceSeed[] = [
  {
    name: 'Home Cleaning',
    description: 'Professional cleaning for every corner of your home by trained, background-verified experts.',
    process: 'Inspection of the area\nDusting and dry cleaning\nWet cleaning with safe chemicals\nFinal walkthrough with you',
    image: '1581578731548-c64695cc6952',
    originalPrice: 1499,
    discountedPrice: 1199,
    duration: '3 hrs',
    subservices: [
      { name: 'Full Home Deep Cleaning', description: 'Top-to-bottom deep cleaning of all rooms, kitchen and bathrooms.', process: 'Dusting of all surfaces\nVacuuming and mopping\nKitchen and bathroom scrubbing\nWindow and fan cleaning', image: '1527515637462-cff94eecc1ac', originalPrice: 3999, discountedPrice: 3299, duration: '6 hrs' },
      { name: 'Bathroom Cleaning', description: 'Removal of hard-water stains, tiles and fixture scrubbing.', process: 'Tile and grout scrubbing\nDescaling of taps and showers\nToilet and basin disinfection', image: '1584622650111-993a426fbf0a', originalPrice: 599, discountedPrice: 449, duration: '1 hr' },
      { name: 'Kitchen Cleaning', description: 'Degreasing of chimney, stove, cabinets and slab.', process: 'Degreasing of stove and chimney exterior\nCabinet inside/outside wipe\nSlab and sink scrubbing', image: '1556911220-bff31c812dba', originalPrice: 1299, discountedPrice: 999, duration: '3 hrs' },
      { name: 'Sofa Cleaning', description: 'Shampoo and vacuum cleaning for fabric sofas.', process: 'Dry vacuuming\nShampoo application\nWet extraction and drying', image: '1555041469-a586c61ea9bc', originalPrice: 799, discountedPrice: 599, duration: '1.5 hrs' },
    ],
  },
  {
    name: 'Plumbing',
    description: 'Quick fixes for leaks, blockages and new fittings, with a 30-day service warranty.',
    process: 'Diagnosis of the issue\nQuote shared before work\nRepair or installation\nLeak test and cleanup',
    image: '1607472586893-edb57bdc0e39',
    originalPrice: 299,
    discountedPrice: 199,
    duration: '1 hr',
    subservices: [
      { name: 'Pipe Leakage Repair', description: 'Fix leaking pipes, joints and concealed lines.', process: 'Locate the leak\nReplace or seal the joint\nPressure test', image: '1607472586893-edb57bdc0e39', originalPrice: 399, discountedPrice: 299, duration: '1 hr' },
      { name: 'Bathroom Fittings Installation', description: 'Install taps, showers, wash basins and accessories.', process: 'Remove old fitting\nInstall and seal new fitting\nCheck water flow', image: '1631889993959-41b4e9c6e3c5', originalPrice: 499, discountedPrice: 349, duration: '1 hr' },
      { name: 'Kitchen Sink Unclogging', description: 'Clear blocked kitchen sinks and drain pipes.', process: 'Inspect the drain\nClear blockage with tools\nFlush and test drainage', image: '1556911220-bff31c812dba', originalPrice: 349, discountedPrice: 249, duration: '45 mins' },
    ],
  },
  {
    name: 'Electrical',
    description: 'Certified electricians for repairs, installations and wiring work.',
    process: 'Safety check\nFault diagnosis\nRepair or installation\nTesting with you',
    image: '1621905251189-08b45d6a269e',
    originalPrice: 249,
    discountedPrice: 149,
    duration: '1 hr',
    subservices: [
      { name: 'Switch & Socket Repair', description: 'Repair or replace faulty switches, sockets and switchboards.', process: 'Isolate the circuit\nReplace the switch/socket\nTest the connection', image: '1621905251918-48416bd8575a', originalPrice: 199, discountedPrice: 129, duration: '30 mins' },
      { name: 'Fan & Light Installation', description: 'Install ceiling fans, wall lights and decorative lamps.', process: 'Mount bracket\nWire and fix the fixture\nTest operation', image: '1513694203232-719a280e022f', originalPrice: 399, discountedPrice: 299, duration: '1 hr' },
      { name: 'Smart Lock Installation', description: 'Install and configure smart door locks with app setup.', process: 'Fit lock to the door\nPair with your phone\nDemo of features', image: '1558002038-1055907df827', originalPrice: 999, discountedPrice: 799, duration: '1.5 hrs' },
    ],
  },
  {
    name: 'Appliance Repair',
    description: 'Doorstep repair for washing machines, refrigerators and other home appliances.',
    process: 'Visit and diagnosis\nQuote for spare parts\nRepair with genuine parts\nPerformance test',
    image: '1626806787461-102c1bfaaea1',
    originalPrice: 399,
    discountedPrice: 299,
    duration: '1.5 hrs',
    subservices: [
      { name: 'Washing Machine Repair', description: 'Fix drum, motor, drainage and electrical issues.', process: 'Diagnose the fault\nReplace faulty part\nRun a test cycle', image: '1626806787426-5910811b6325', originalPrice: 499, discountedPrice: 349, duration: '1.5 hrs' },
      { name: 'Refrigerator Repair', description: 'Cooling problems, gas refill and compressor checks.', process: 'Check cooling and compressor\nRepair or gas refill\nMonitor temperature', image: '1571175443880-49e1d25b2bc5', originalPrice: 599, discountedPrice: 449, duration: '2 hrs' },
      { name: 'Washing Machine Service', description: 'Routine deep cleaning and servicing of the drum and filters.', process: 'Drum descaling\nFilter cleaning\nTest wash', image: '1610557892470-55d9e80c0bce', originalPrice: 699, discountedPrice: 499, duration: '1.5 hrs' },
    ],
  },
  {
    name: 'Painting',
    description: 'Interior and exterior painting with premium paints and furniture protection.',
    process: 'Colour consultation\nFurniture covering and masking\nSurface prep and primer\nTwo coats of paint and cleanup',
    image: '1562259949-e8e7689d7828',
    originalPrice: 4999,
    discountedPrice: 3999,
    duration: '1 day',
    subservices: [
      { name: 'Single Room Painting', description: 'Fresh coat for one room, walls and ceiling.', process: 'Masking and covering\nPutty and primer\nTwo coats of paint', image: '1595814433015-e6f5ce69614e', originalPrice: 5999, discountedPrice: 4799, duration: '1 day' },
      { name: 'Full Home Painting', description: 'Complete interior painting for 2BHK/3BHK homes.', process: 'Site inspection\nSurface preparation\nPainting of all rooms\nPost-paint cleaning', image: '1600585154340-be6161a56a0c', originalPrice: 24999, discountedPrice: 19999, duration: '4 days' },
      { name: 'Accent Wall Painting', description: 'Statement wall with a bold colour or texture.', process: 'Colour selection\nWall prep\nPaint or texture finish', image: '1617104678098-de229db51175', originalPrice: 2499, discountedPrice: 1899, duration: '5 hrs' },
    ],
  },
  {
    name: 'Salon at Home',
    description: 'Salon-quality grooming and beauty services in the comfort of your home.',
    process: 'Hygiene kit setup\nService as per your choice\nCleanup of the area',
    image: '1522337360788-8b13dee7a37e',
    originalPrice: 999,
    discountedPrice: 799,
    duration: '1 hr',
    subservices: [
      { name: 'Haircut & Styling', description: 'Haircut, blow-dry and styling by expert stylists.', process: 'Consultation\nWash and cut\nBlow-dry and style', image: '1562322140-8baeececf3df', originalPrice: 699, discountedPrice: 499, duration: '1 hr' },
      { name: 'Facial & Cleanup', description: 'Deep-cleansing facial for glowing skin.', process: 'Cleansing\nScrub and steam\nMask and massage', image: '1570172619644-dfd03ed5d881', originalPrice: 1299, discountedPrice: 999, duration: '1 hr' },
      { name: 'Manicure', description: 'Nail shaping, cuticle care and polish.', process: 'Soak and clean\nShape and cuticle care\nPolish', image: '1604654894610-df63bc536371', originalPrice: 599, discountedPrice: 449, duration: '45 mins' },
      { name: 'Party Makeup', description: 'Full makeup for parties and occasions.', process: 'Skin prep\nBase and eyes\nFinishing touches', image: '1516975080664-ed2fc6a32937', originalPrice: 2499, discountedPrice: 1999, duration: '1.5 hrs' },
    ],
  },
];

const PROVIDERS = [
  { name: 'Rahul Verma', phoneNumber: '9000010001', photo: '1507003211169-0a1dd7228f2d', services: ['Electrical', 'Appliance Repair'], experience: 6, qualification: 'ITI Electrician', status: 'active' as const },
  { name: 'Amit Das', phoneNumber: '9000010002', photo: '1500648767791-00dcc994a43e', services: ['Plumbing'], experience: 8, qualification: 'Diploma in Plumbing', status: 'active' as const },
  { name: 'Priya Sharma', phoneNumber: '9000010003', photo: '1544005313-94ddf0286df2', services: ['Salon at Home'], experience: 4, qualification: 'Certified Beautician', status: 'active' as const },
  { name: 'Suresh Ghosh', phoneNumber: '9000010004', photo: '1472099645785-5658abf4ff4e', services: ['Painting'], experience: 12, qualification: '10th Pass', status: 'active' as const },
  { name: 'Neha Roy', phoneNumber: '9000010005', photo: '1438761681033-6461ffad8d80', services: ['Home Cleaning'], experience: 3, qualification: '12th Pass', status: 'active' as const },
  { name: 'Vikram Singh', phoneNumber: '9000010006', photo: '1506794778202-cad84cf45f1d', services: ['Home Cleaning', 'Plumbing'], experience: 18, experienceUnit: 'months' as const, qualification: '12th Pass', status: 'verification_pending' as const },
  { name: 'Anjali Sen', phoneNumber: '9000010007', photo: '1534528741775-53994a69daeb', services: ['Salon at Home'], experience: 2, qualification: 'Diploma in Cosmetology', status: 'pending' as const },
  { name: 'Karan Mehta', phoneNumber: '9000010008', photo: '1519085360753-af0119f7cbe7', services: ['Electrical'], experience: 5, qualification: 'ITI Electrician', status: 'inactive' as const },
];

/** Downloads an Unsplash photo and stores it in the bucket; returns the public URL. */
async function uploadImage(photoId: string, folder: string, name: string) {
  const res = await fetch(unsplash(photoId));
  if (!res.ok) throw new Error(`Failed to download image ${photoId}: ${res.status}`);
  const key = `${SEED_PREFIX}/${folder}/${slugify(name)}.jpg`;
  const { error } = await supabase()
    .storage.from(STORAGE_BUCKET)
    .upload(key, Buffer.from(await res.arrayBuffer()), { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return supabase().storage.from(STORAGE_BUCKET).getPublicUrl(key).data.publicUrl;
}

async function clean() {
  const serviceNames = SERVICES.map((s) => s.name);
  const seededServices = { service: { name: { in: serviceNames } } };

  // Ratings restrict deletion of subservices/services, so they go first.
  const ratings = await prisma.rating.deleteMany({
    where: { OR: [{ booking: { notes: { startsWith: SEED_NOTE } } }, seededServices] },
  });
  const bookings = await prisma.booking.deleteMany({ where: { notes: { startsWith: SEED_NOTE } } });
  const providers = await prisma.serviceProvider.deleteMany({ where: { email: { endsWith: PROVIDER_EMAIL_DOMAIN } } });
  const services = await prisma.service.deleteMany({ where: { name: { in: serviceNames } } }); // subservices cascade
  console.log(`Removed ${ratings.count} ratings, ${bookings.count} bookings, ${providers.count} providers, ${services.count} services`);
}

async function removeSeedImages() {
  for (const folder of ['services', 'subservices', 'providers']) {
    const prefix = `${SEED_PREFIX}/${folder}`;
    const { data, error } = await supabase().storage.from(STORAGE_BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;
    if (data.length) {
      const { error: removeError } = await supabase()
        .storage.from(STORAGE_BUCKET)
        .remove(data.map((f) => `${prefix}/${f.name}`));
      if (removeError) throw removeError;
    }
  }
  console.log('Removed seed images from storage');
}

async function seed() {
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
  const client = await prisma.user.findFirst({
    where: { role: 'client' },
    orderBy: { createdAt: 'asc' },
    include: { addresses: { take: 1, orderBy: { createdAt: 'asc' } } },
  });
  if (!admin) throw new Error('No admin user found; create one before seeding.');
  if (!client) throw new Error('No client user found; log into the app once before seeding.');

  await clean();

  // Catalogue
  const subservicesByService = new Map<string, { id: string; name: string; discountedPrice: number }[]>();
  const serviceIds = new Map<string, string>();
  for (const { subservices, ...svc } of SERVICES) {
    const service = await prisma.service.create({
      data: { ...svc, image: await uploadImage(svc.image, 'services', svc.name) },
    });
    serviceIds.set(service.name, service.id);

    const subs = [];
    for (const sub of subservices) {
      subs.push(
        await prisma.subservice.create({
          data: { ...sub, serviceId: service.id, image: await uploadImage(sub.image, 'subservices', sub.name) },
        }),
      );
    }
    subservicesByService.set(service.name, subs);
    console.log(`✓ ${service.name} (${subs.length} subservices)`);
  }

  for (const coupon of COUPONS) {
    await prisma.coupon.upsert({ where: { code: coupon.code }, create: coupon, update: coupon });
  }
  console.log(`✓ ${COUPONS.length} coupons`);

  // Providers
  const providers = [];
  for (const [i, p] of PROVIDERS.entries()) {
    const subs = p.services.flatMap((s) => subservicesByService.get(s)!);
    const verified = p.status !== 'verification_pending';
    providers.push(
      await prisma.serviceProvider.create({
        data: {
          name: p.name,
          email: `${slugify(p.name).replace('-', '.')}${PROVIDER_EMAIL_DOMAIN}`,
          phoneNumber: p.phoneNumber,
          address: `${12 + i}, Park Street, Kolkata, West Bengal 700016`,
          passportPhoto: await uploadImage(p.photo, 'providers', p.name),
          passportPhotoS3Key: `${SEED_PREFIX}/providers/${slugify(p.name)}.jpg`,
          aadhaarVerified: verified,
          panVerified: verified,
          specializations: subs.map((s) => s.name),
          experience: p.experience,
          experienceUnit: p.experienceUnit ?? 'years',
          qualification: p.qualification,
          availability: Object.fromEntries(
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [
              d,
              { start: '09:00', end: '19:00', available: d !== 'sunday' },
            ]),
          ),
          status: p.status,
          bankAccountNumber: `5010010${String(100000 + i)}`,
          bankIfscCode: 'HDFC0000123',
          bankAccountHolderName: p.name,
          bankName: 'HDFC Bank',
          commission: 10 + (i % 3) * 5,
          createdById: admin.id,
          verifiedById: verified ? admin.id : null,
          verifiedAt: verified ? daysFromNow(-30) : null,
          notes: `${SEED_NOTE} demo provider`,
          createdAt: daysFromNow(-60 + i),
          services: { connect: p.services.map((s) => ({ id: serviceIds.get(s)! })) },
          subservices: { connect: subs.map((s) => ({ id: s.id })) },
        },
      }),
    );
  }
  console.log(`✓ ${providers.length} providers`);

  // Bookings for the existing client; subs/provider are indexes into the lists above, day is offset from today.
  const addressId = client.addresses[0]?.id ?? null;
  const BOOKINGS = [
    { service: 'Home Cleaning', subs: [1], provider: 4, status: 'completed', day: -20, payment: 'online', rating: [5, 'approved', 'Spotless bathroom, very polite.'] },
    { service: 'Electrical', subs: [0, 1], provider: 0, status: 'completed', day: -15, payment: 'cash', rating: [4, 'approved', 'Quick and neat work.'] },
    { service: 'Salon at Home', subs: [1], provider: 2, status: 'completed', day: -10, payment: 'online', coupon: 'WELCOME100', rating: [5, 'pending', 'Loved the facial, will book again!'] },
    { service: 'Plumbing', subs: [0], provider: 1, status: 'completed', day: -7, payment: 'cash', rating: [3, 'pending', 'Fixed the leak but arrived late.'] },
    { service: 'Painting', subs: [2], provider: 3, status: 'completed', day: -5, payment: 'online' },
    { service: 'Appliance Repair', subs: [0], provider: 0, status: 'confirmed', day: 1, payment: 'cash' },
    { service: 'Home Cleaning', subs: [0], provider: 4, status: 'confirmed', day: 3, payment: 'online', coupon: 'FESTIVE50' },
    { service: 'Salon at Home', subs: [0, 2], status: 'pending', day: 2, payment: 'cash' },
    { service: 'Plumbing', subs: [1], status: 'pending', day: 4, payment: 'cash' },
    { service: 'Electrical', subs: [2], status: 'cancelled', day: -3, payment: 'cash', reason: 'Changed my plans' },
  ] as const;

  let ratingCount = 0;
  for (const b of BOOKINGS) {
    const subs = b.subs.map((i) => subservicesByService.get(b.service)![i]);
    const total = subs.reduce((sum, s) => sum + s.discountedPrice, 0);
    const coupon = 'coupon' in b ? COUPONS.find((c) => c.code === b.coupon)! : undefined;
    const discount = coupon ? Math.min(coupon.type === 'percent' ? (total * coupon.value) / 100 : coupon.value, coupon.maxDiscount ?? Infinity) : 0;
    const provider = 'provider' in b ? providers[b.provider] : undefined;
    const date = daysFromNow(b.day);
    const completed = b.status === 'completed';

    const booking = await prisma.booking.create({
      data: {
        userId: client.id,
        addressId,
        serviceProviderId: provider?.id,
        date,
        time: ['10:00 AM', '12:00 PM', '3:00 PM', '5:00 PM'][Math.abs(b.day) % 4],
        status: b.status,
        discount,
        finalPrice: Math.max(0, total - discount),
        couponCode: coupon?.code,
        paymentMethod: b.payment,
        paymentStatus: completed || b.payment === 'online' ? 'paid' : 'pending',
        razorpayOrderId: b.payment === 'online' ? `order_seed${Math.abs(b.day)}${b.subs.join('')}` : null,
        razorpayPaymentId: b.payment === 'online' ? `pay_seed${Math.abs(b.day)}${b.subs.join('')}` : null,
        serviceOtp: String(1000 + Math.abs(b.day) * 37),
        assignedAt: provider ? new Date(date.getTime() - DAY) : null,
        assignedById: provider ? admin.id : null,
        startedAt: completed ? date : null,
        completedAt: completed ? new Date(date.getTime() + 2 * 60 * 60 * 1000) : null,
        cancellationReason: 'reason' in b ? b.reason : null,
        cancelledAt: b.status === 'cancelled' ? new Date(date.getTime() - DAY) : null,
        tip: completed && b.day % 2 === 0 ? 50 : 0,
        notes: `${SEED_NOTE} demo booking`,
        createdAt: new Date(date.getTime() - 2 * DAY),
        services: { connect: { id: serviceIds.get(b.service)! } },
        subservices: { connect: subs.map((s) => ({ id: s.id })) },
      },
    });

    if ('rating' in b && provider) {
      const [rating, status, feedback] = b.rating;
      for (const sub of subs) {
        await prisma.rating.create({
          data: {
            bookingId: booking.id,
            userId: client.id,
            serviceProviderId: provider.id,
            subserviceId: sub.id,
            serviceId: serviceIds.get(b.service)!,
            rating,
            feedback,
            status,
            reviewedById: status === 'approved' ? admin.id : null,
            reviewedAt: status === 'approved' ? new Date(date.getTime() + DAY) : null,
          },
        });
        ratingCount++;
      }
    }
  }
  console.log(`✓ ${BOOKINGS.length} bookings for client ${client.phoneNumber}, ${ratingCount} ratings`);

  // Provider rating stats count approved ratings only, as RatingService does on approval.
  for (const provider of providers) {
    const approved = await prisma.rating.findMany({ where: { serviceProviderId: provider.id, status: 'approved' }, select: { rating: true } });
    if (!approved.length) continue;
    const counts = [1, 2, 3, 4, 5].map((n) => approved.filter((r) => r.rating === n).length);
    await prisma.serviceProvider.update({
      where: { id: provider.id },
      data: {
        ratingTotal: approved.length,
        ratingAverage: Math.round((approved.reduce((s, r) => s + r.rating, 0) / approved.length) * 10) / 10,
        ratingCount1: counts[0],
        ratingCount2: counts[1],
        ratingCount3: counts[2],
        ratingCount4: counts[3],
        ratingCount5: counts[4],
      },
    });
  }
}

async function main() {
  if (process.argv.includes('--clean')) {
    await clean();
    await removeSeedImages();
  } else {
    await seed();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
