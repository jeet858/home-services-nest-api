/**
 * One-off copy of the MongoDB data into PostgreSQL.
 *
 *   npm run migrate:mongo -- --dry-run   # transform + report, no writes
 *   npm run migrate:mongo                # write into DATABASE_URL
 *
 * Mongo is only read. Source: MONGODB_URI, or the original DB_USER/DB_PASSWORD/DB_NAME on cluster0.
 * Run `npm run db:migrate` on the target first. Safe to re-run: ids are deterministic and inserts skip conflicts.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { MongoClient, ObjectId } from 'mongodb';
import { v5 as uuidv5 } from 'uuid';
import { PrismaClient } from '../src/generated/prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
// Fixed namespace: the same ObjectId always maps to the same UUID, so refs resolve without a lookup table.
const NAMESPACE = '4f0c7a52-3b1e-4f7a-9a55-6c2d8e1b9f10';
const CHUNK = 500;

const toId = (oid: unknown): string | null => (oid ? uuidv5(String(oid instanceof ObjectId ? oid.toHexString() : oid), NAMESPACE) : null);
const str = (v: unknown) => (v === undefined || v === null ? null : String(v));
const num = (v: unknown, fallback: number | null = null) => (v === undefined || v === null || Number.isNaN(Number(v)) ? fallback : Number(v));
const date = (v: unknown) => (v ? new Date(v as any) : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

type Report = { read: number; prepared: number; inserted: number; skipped: Record<string, number> };
const reports: Record<string, Report> = {};
const report = (name: string) => (reports[name] ??= { read: 0, prepared: 0, inserted: 0, skipped: {} });
const skip = (name: string, reason: string) => {
  const r = report(name);
  r.skipped[reason] = (r.skipped[reason] ?? 0) + 1;
};

function mongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const { DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_USER || !DB_PASSWORD || !DB_NAME) throw new Error('Set MONGODB_URI or DB_USER/DB_PASSWORD/DB_NAME');
  // Same connection string as src/database/mongodb.database.js.
  return `mongodb+srv://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@cluster0.ieottwj.mongodb.net/${DB_NAME}?retryWrites=true&w=majority`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (target Postgres) is required');

  const mongo = await MongoClient.connect(mongoUri(), { serverSelectionTimeoutMS: 10000 });
  const db = mongo.db();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const all = async (collection: string) => {
    const docs = await db.collection(collection).find().toArray();
    report(collection).read = docs.length;
    return docs;
  };

  // Batched createMany; ON CONFLICT DO NOTHING makes re-runs idempotent.
  async function insert(name: string, delegate: { createMany: (args: any) => Promise<{ count: number }> }, rows: any[]) {
    report(name).prepared = rows.length;
    if (DRY_RUN) return;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { count } = await delegate.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
      report(name).inserted += count;
    }
  }

  // Implicit m2m join tables (see migration.sql for A/B orientation).
  async function link(table: string, pairs: [string, string][]) {
    report(table).prepared = pairs.length;
    if (DRY_RUN) return;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const chunk = pairs.slice(i, i + CHUNK);
      const count = await prisma.$executeRawUnsafe(
        `INSERT INTO "${table}" ("A","B") SELECT * FROM unnest($1::uuid[], $2::uuid[]) ON CONFLICT DO NOTHING`,
        chunk.map((p) => p[0]),
        chunk.map((p) => p[1]),
      );
      report(table).inserted += count;
    }
  }

  try {
    // ---- users ----
    const userIds = new Set<string>();
    const phones = new Set<string>();
    const users = (await all('users')).flatMap((u) => {
      const phoneNumber = String(u.phoneNumber ?? '').replace(/\D/g, '');
      if (!phoneNumber) return skip('users', 'missing phoneNumber'), [];
      if (phones.has(phoneNumber)) return skip('users', 'duplicate phoneNumber after normalising'), [];
      phones.add(phoneNumber);
      const id = toId(u._id);
      userIds.add(id);
      return [{
        id,
        phoneNumber,
        name: str(u.name),
        email: str(u.email),
        password: str(u.password) ?? 'Not Required',
        avatar: str(u.avatar),
        role: oneOf(u.role, ['client', 'admin'] as const, 'client'),
        lastLogin: date(u.lastLogin),
        createdAt: date(u.createdAt) ?? new Date(),
      }];
    });
    await insert('users', prisma.user, users);

    // ---- addresses ----
    const addressIds = new Set<string>();
    const addresses = (await all('addresses')).flatMap((a) => {
      const userId = toId(a.userId);
      if (!userIds.has(userId)) return skip('addresses', 'dangling userId'), [];
      const missing = ['street', 'city', 'state', 'zip', 'country'].find((f) => a[f] === undefined || a[f] === null);
      if (missing) return skip('addresses', `missing ${missing}`), [];
      const id = toId(a._id);
      addressIds.add(id);
      return [{
        id,
        userId,
        houseNo: str(a.houseNo),
        street: String(a.street),
        fullAddress: str(a.fullAddress),
        landmark: str(a.landmark),
        city: String(a.city),
        state: String(a.state),
        zip: String(a.zip),
        country: String(a.country),
        lat: num(a.lat),
        lng: num(a.lng),
        createdAt: date(a.createdAt) ?? new Date(),
      }];
    });
    await insert('addresses', prisma.address, addresses);

    // ---- services ----
    const serviceIds = new Set<string>();
    const services = (await all('services')).flatMap((s) => {
      if (!s.name || num(s.originalPrice) === null || num(s.discountedPrice) === null || !s.duration) {
        return skip('services', 'missing required field'), [];
      }
      const id = toId(s._id);
      serviceIds.add(id);
      return [{
        id,
        name: String(s.name),
        description: str(s.description),
        process: str(s.process),
        originalPrice: num(s.originalPrice),
        discountedPrice: num(s.discountedPrice),
        duration: String(s.duration),
        image: str(s.image),
        createdAt: date(s.createdAt) ?? new Date(),
      }];
    });
    await insert('services', prisma.service, services);

    // ---- subservices (Service.subservices[] is dropped; the link is Subservice.serviceId) ----
    const subserviceIds = new Set<string>();
    const subserviceService = new Map<string, string>();
    const subservices = (await all('subservices')).flatMap((s) => {
      const serviceId = toId(s.serviceId);
      if (!serviceIds.has(serviceId)) return skip('subservices', 'dangling serviceId'), [];
      if (!s.name || num(s.originalPrice) === null || num(s.discountedPrice) === null || !s.duration) {
        return skip('subservices', 'missing required field'), [];
      }
      const id = toId(s._id);
      subserviceIds.add(id);
      subserviceService.set(id, serviceId);
      return [{
        id,
        name: String(s.name),
        serviceId,
        description: str(s.description),
        process: str(s.process),
        image: str(s.image),
        originalPrice: num(s.originalPrice),
        discountedPrice: num(s.discountedPrice),
        duration: String(s.duration),
        createdAt: date(s.createdAt) ?? new Date(),
      }];
    });
    await insert('subservices', prisma.subservice, subservices);

    // ---- service providers (embedded docs flattened; arrays go to join/child tables) ----
    const providerIds = new Set<string>();
    const providerServices: [string, string][] = [];
    const providerSubservices: [string, string][] = [];
    const certifications: any[] = [];
    const documents: any[] = [];
    const providers = (await all('serviceproviders')).flatMap((p) => {
      if (!p.name || !p.email || !p.phoneNumber) return skip('serviceproviders', 'missing name/email/phoneNumber'), [];
      const id = toId(p._id);
      providerIds.add(id);

      for (const s of p.services ?? []) {
        const sid = toId(s);
        if (serviceIds.has(sid)) providerServices.push([sid, id]);
        else skip('_ProviderServices', 'dangling service id');
      }
      for (const s of p.subservices ?? []) {
        const sid = toId(s);
        if (subserviceIds.has(sid)) providerSubservices.push([id, sid]);
        else skip('_ProviderSubservices', 'dangling subservice id');
      }
      for (const c of p.certifications ?? []) {
        if (!c.name || !c.issuingAuthority) { skip('certifications', 'missing name/issuingAuthority'); continue; }
        certifications.push({
          id: toId(c._id ?? new ObjectId()),
          providerId: id,
          name: String(c.name),
          issuingAuthority: String(c.issuingAuthority),
          issueDate: date(c.issueDate),
          expiryDate: date(c.expiryDate),
          certificateNumber: str(c.certificateNumber),
        });
      }
      for (const d of p.documents ?? []) {
        if (!d.type || !d.name || !d.url) { skip('documents', 'missing type/name/url'); continue; }
        documents.push({
          id: toId(d._id ?? new ObjectId()),
          providerId: id,
          type: String(d.type),
          name: String(d.name),
          url: String(d.url),
          uploadedAt: date(d.uploadedAt) ?? new Date(),
          verified: Boolean(d.verified),
        });
      }

      const createdById = toId(p.createdBy);
      const verifiedById = toId(p.verifiedBy);
      return [{
        id,
        name: String(p.name).trim(),
        email: String(p.email).trim().toLowerCase(),
        phoneNumber: String(p.phoneNumber),
        address: typeof p.address === 'string' ? p.address : null,
        aadhaarNumber: str(p.aadhaarCard?.number),
        aadhaarImage: str(p.aadhaarCard?.image),
        aadhaarS3Key: str(p.aadhaarCard?.s3Key),
        aadhaarVerified: Boolean(p.aadhaarCard?.verified),
        panNumber: str(p.panCard?.number),
        panImage: str(p.panCard?.image),
        panS3Key: str(p.panCard?.s3Key),
        panVerified: Boolean(p.panCard?.verified),
        passportPhoto: str(p.passportPhoto),
        passportPhotoS3Key: str(p.passportPhotoS3Key),
        specializations: (p.specializations ?? []).map(String),
        experience: num(p.experience, 0),
        experienceUnit: oneOf(p.experienceUnit, ['months', 'years'] as const, 'years'),
        qualification: str(p.qualification),
        availability: p.availability ?? {},
        status: oneOf(p.status, ['active', 'inactive', 'suspended', 'pending', 'verification_pending'] as const, 'verification_pending'),
        // Rating counters are rebuilt from approved ratings below.
        bankAccountNumber: str(p.bankDetails?.accountNumber),
        bankIfscCode: str(p.bankDetails?.ifscCode),
        bankAccountHolderName: str(p.bankDetails?.accountHolderName),
        bankName: str(p.bankDetails?.bankName),
        commission: num(p.commission, 10),
        createdById: userIds.has(createdById) ? createdById : null,
        verifiedById: userIds.has(verifiedById) ? verifiedById : null,
        verifiedAt: date(p.verifiedAt),
        notes: str(p.notes),
        createdAt: date(p.createdAt) ?? new Date(),
        updatedAt: date(p.updatedAt) ?? new Date(),
      }];
    });
    await insert('serviceproviders', prisma.serviceProvider, providers);
    await insert('certifications', prisma.providerCertification, certifications);
    await insert('documents', prisma.providerDocument, documents);
    await link('_ProviderServices', providerServices);
    await link('_ProviderSubservices', providerSubservices);

    // ---- bookings (optional refs that dangle become NULL) ----
    const bookingIds = new Set<string>();
    const bookingServices: [string, string][] = [];
    const bookingSubservices: [string, string][] = [];
    const bookings = (await all('bookings')).flatMap((b) => {
      const userId = toId(b.userId);
      if (!userIds.has(userId)) return skip('bookings', 'dangling userId'), [];
      if (!b.date || !b.time || num(b.finalPrice) === null) return skip('bookings', 'missing date/time/finalPrice'), [];
      const id = toId(b._id);
      bookingIds.add(id);

      for (const s of b.services ?? []) {
        const sid = toId(s);
        if (serviceIds.has(sid)) bookingServices.push([id, sid]);
        else skip('_BookingServices', 'dangling service id');
      }
      for (const s of b.subservices ?? []) {
        const sid = toId(s);
        if (subserviceIds.has(sid)) bookingSubservices.push([id, sid]);
        else skip('_BookingSubservices', 'dangling subservice id');
      }

      const addressId = toId(b.addressId);
      const serviceProviderId = toId(b.serviceProviderId);
      const assignedById = toId(b.assignedBy);
      return [{
        id,
        userId,
        addressId: addressIds.has(addressId) ? addressId : null,
        serviceProviderId: providerIds.has(serviceProviderId) ? serviceProviderId : null,
        date: date(b.date),
        time: String(b.time),
        status: oneOf(b.status, ['pending', 'confirmed', 'completed', 'cancelled'] as const, 'pending'),
        discount: num(b.discount, 0),
        finalPrice: num(b.finalPrice),
        assignedAt: date(b.assignedAt),
        assignedById: userIds.has(assignedById) ? assignedById : null,
        createdAt: date(b.createdAt) ?? new Date(),
      }];
    });
    await insert('bookings', prisma.booking, bookings);
    await link('_BookingServices', bookingServices);
    await link('_BookingSubservices', bookingSubservices);

    // ---- ratings ----
    const ratingKeys = new Set<string>();
    const ratings = (await all('ratings')).flatMap((r) => {
      const bookingId = toId(r.booking);
      const userId = toId(r.user);
      const subserviceId = toId(r.subservice);
      const serviceId = toId(r.service);
      if (!bookingIds.has(bookingId)) return skip('ratings', 'dangling booking'), [];
      if (!userIds.has(userId)) return skip('ratings', 'dangling user'), [];
      if (!subserviceIds.has(subserviceId) || !serviceIds.has(serviceId)) return skip('ratings', 'dangling subservice/service'), [];
      const value = num(r.rating);
      if (!Number.isInteger(value) || value < 1 || value > 5) return skip('ratings', 'rating not an integer 1-5'), [];
      const key = `${bookingId}:${subserviceId}`;
      if (ratingKeys.has(key)) return skip('ratings', 'duplicate booking+subservice'), [];
      ratingKeys.add(key);
      const serviceProviderId = toId(r.serviceProvider);
      const reviewedById = toId(r.reviewedBy);
      return [{
        id: toId(r._id),
        bookingId,
        userId,
        serviceProviderId: providerIds.has(serviceProviderId) ? serviceProviderId : null,
        subserviceId,
        serviceId,
        rating: value,
        feedback: String(r.feedback ?? ''),
        status: oneOf(r.status, ['pending', 'approved', 'rejected'] as const, 'pending'),
        reviewedById: userIds.has(reviewedById) ? reviewedById : null,
        reviewedAt: date(r.reviewedAt),
        reviewNote: str(r.reviewNote),
        createdAt: date(r.createdAt) ?? new Date(),
        updatedAt: date(r.updatedAt) ?? new Date(),
      }];
    });
    await insert('ratings', prisma.rating, ratings);

    // ---- provider rating counters: rebuilt from approved ratings (Mongo double-counted re-approvals) ----
    const stats = new Map<string, number[]>();
    for (const r of ratings) {
      if (r.status !== 'approved' || !r.serviceProviderId) continue;
      const counts = stats.get(r.serviceProviderId) ?? [0, 0, 0, 0, 0];
      counts[r.rating - 1]++;
      stats.set(r.serviceProviderId, counts);
    }
    report('provider rating stats').prepared = stats.size;
    if (!DRY_RUN) {
      for (const [id, counts] of stats) {
        const total = counts.reduce((a, b) => a + b, 0);
        const sum = counts.reduce((acc, c, i) => acc + (i + 1) * c, 0);
        await prisma.serviceProvider.update({
          where: { id },
          data: {
            ratingCount1: counts[0], ratingCount2: counts[1], ratingCount3: counts[2], ratingCount4: counts[3], ratingCount5: counts[4],
            ratingTotal: total,
            ratingAverage: total ? Math.round((sum / total) * 100) / 100 : 0,
          },
        });
        report('provider rating stats').inserted++;
      }
    }

    report('otps').read = await db.collection('otps').countDocuments();
    skip('otps', 'ephemeral, not migrated');
  } finally {
    await mongo.close();
    await prisma.$disconnect();
  }

  console.log(DRY_RUN ? '\nDRY RUN — nothing written\n' : '\nMigration finished\n');
  console.table(
    Object.entries(reports).map(([name, r]) => ({
      collection: name,
      read: r.read,
      prepared: r.prepared,
      inserted: DRY_RUN ? '-' : r.inserted,
      skipped: Object.entries(r.skipped).map(([k, v]) => `${k}: ${v}`).join('; '),
    })),
  );
  if (!DRY_RUN) console.log('inserted < prepared means rows already existed (re-run) or hit a unique constraint.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
