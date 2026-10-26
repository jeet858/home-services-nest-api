/**
 * Seeds the promo codes shown on the app's Offers screen.
 *
 *   npx tsx scripts/seed-coupons.ts
 *
 * Safe to re-run: existing codes are updated in place.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const COUPONS = [
  {
    code: 'SUBIDHA30',
    title: 'Special Monsoon',
    description: 'Get 30% off up to ₹150 on plumbing and appliance services.',
    tag: 'SEASONAL',
    type: 'percent' as const,
    value: 30,
    maxDiscount: 150,
    minOrder: 199,
    validTill: inDays(30),
  },
  {
    code: 'WELCOME100',
    title: 'New User First Booking',
    description: 'Flat ₹100 off on minimum booking value of ₹399.',
    tag: 'NEW USER',
    type: 'flat' as const,
    value: 100,
    minOrder: 399,
    perUserLimit: 3,
  },
  {
    code: 'PAYTM15',
    title: 'Paytm UPI Cashback',
    description: 'Instant 15% cashback credited to your Subidha wallet.',
    tag: 'PARTNER OFFER',
    type: 'cashback' as const,
    value: 15,
    maxDiscount: 100,
    validTill: inDays(20),
  },
  {
    code: 'FESTIVE50',
    title: 'Full Deep Cleaning',
    description: 'Get ₹250 flat off on complete home deep sanitization & dusting.',
    tag: 'FESTIVE SPECIAL',
    type: 'flat' as const,
    value: 250,
    minOrder: 999,
    validTill: inDays(45),
  },
];

async function main() {
  for (const coupon of COUPONS) {
    await prisma.coupon.upsert({ where: { code: coupon.code }, create: coupon, update: coupon });
    console.log(`✓ ${coupon.code}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
