# Home Services API (NestJS + Prisma)

A NestJS port of the Express API in `../home-services-API/src`, backed by PostgreSQL through Prisma 7, with provider images stored in Supabase Storage. See [PORTING_NOTES.md](PORTING_NOTES.md) for what changed and why.

## Setup

```bash
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, SUPABASE_* ...
npm install                   # also runs `prisma generate`
npm run db:migrate            # apply prisma/migrations
npm run build && npm start    # http://localhost:5000
```

For development, use `npm run start:dev` (watch mode). Use `npm run db:migrate:dev` to create a new migration after you edit `prisma/schema.prisma`; it also regenerates the client, which Prisma 7's `migrate dev` no longer does on its own.

## Supabase Storage

1. In the Supabase dashboard, create a **public** bucket (default name `homeservice`, or set `SUPABASE_BUCKET`).
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only; never ship it to a client.

Uploads (Aadhaar, PAN, passport photo; JPEG/PNG/WebP up to 5MB) are buffered in memory, pushed to the bucket, and their public URL is stored on the provider. The app boots without these variables; only uploads fail, with `400 File upload failed: …`.

## Coupons, payments and booking tracking

```bash
npm run seed:coupons          # SUBIDHA30, WELCOME100, PAYTM15, FESTIVE50 (safe to re-run)
```

- `GET /api/coupons` is public. `POST /api/coupons/validate` (`{ code, amount }`) returns `{ coupon, discount }`. Admins can `POST`, `PUT /:id` and `DELETE /:id`.
- Online payments need `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. `POST /api/payments/order` (`{ amount }` in rupees) returns `{ orderId, amount, currency, keyId }`; `POST /api/payments/verify` checks `{ orderId, paymentId, signature }`.
- `POST /api/booking` also takes:
  - `couponCode` and `itemTotal`: the server re-validates the coupon and recomputes `discount` and `finalPrice`.
  - `paymentMethod` (`online` | `cash`) and `notes`.
  - For online payments, `razorpayOrderId`, `razorpayPaymentId` and `razorpaySignature`. The signature is verified before the booking is saved with `paymentStatus: paid`.
- Each booking gets a 4-digit `serviceOtp`, which the customer shares with the pro.
- `POST /api/booking/my-bookings/:id/tip` (`{ amount }`) records a tip.
- Admin progress updates for the tracking screen:
  - `PATCH /api/booking/:id/start` (`{ otp }`) sets `startedAt`.
  - `PATCH /api/booking/:id/status` (`{ status }`) sets `completedAt` on completion and marks cash bookings paid.

## Moving the data from MongoDB

```bash
npm run migrate:mongo -- --dry-run   # read Mongo, report what would be written
npm run migrate:mongo                # write into DATABASE_URL
```

- The script only reads Mongo. The source is `MONGODB_URI`, or the original `DB_USER`/`DB_PASSWORD`/`DB_NAME`.
- ObjectIds map to deterministic UUIDs (v5), so the script is safe to re-run.
- Rows with dangling required references are skipped and reported. Dangling optional references become NULL.
- Provider rating counters are rebuilt from approved ratings.
- Existing tokens stop working, so everyone has to log in again.

## Layout

```
src/
  bootstrap.ts           middleware stack (same order as src/app.js) + global filter
  common/                errors, error handler, guards, logger, validation helpers
  prisma/                global PrismaService
  storage/               storage.client.ts (Supabase + multer), StorageService, upload interceptor
  <feature>/             controller + service + module per original router (auth, user, address, ...)
prisma/schema.prisma     Postgres schema (Mongo mapping explained inline)
scripts/                 Mongo -> Postgres migration
api/index.js             Vercel entry
```

## Deploying to Vercel

Create a Vercel project pointing at this folder (push it to its own repo first). `vercel.json` builds with `npm run vercel-build` and serves every path from `api/index.js`, in region `bom1` with maxDuration 30s.

Set `DATABASE_URL` to a **pooled** connection string. If migrations need a separate direct connection, set `DIRECT_URL` too.

## Checks

```bash
npm run build
npm run check:circular        # madge: no circular imports
```
