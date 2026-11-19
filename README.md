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

## Automatic assignment

A booking is offered to one professional at a time (`src/assignment/`). They have 2 minutes to accept; on a decline or timeout it moves to the next.

Who is eligible:

- active, online and seen in the last 20 minutes
- offers one of the booking's services, and works that weekday and hour
- has a known location within the last search ring (20 km) of the address
- holds no other open offer, and has no other job within 90 minutes of the slot
- has not declined or dropped this booking; a professional whose offer timed out can be asked again after 10 minutes

Who is picked: the search uses the smallest ring (5, 10, then 20 km) that contains an eligible professional, then takes the highest score in that ring:

| Factor | Weight | Meaning |
|---|---|---|
| Distance | 0.40 | closer to the address within the ring |
| Rating | 0.20 | average rating, smoothed so one review does not decide it |
| Acceptance | 0.15 | share of offers accepted in the last 30 days |
| Workload | 0.15 | fewer jobs already booked that day |
| Fairness | 0.10 | longer since their last offer |

The distance and score of every offer are stored on `BookingAssignment` and shown in the admin panel.

If nobody in range is left, 6 offers have been made, or the booking has waited 15 minutes, `Booking.matchEscalatedAt` is set once. The customer is told the search is taking longer and the admin panel marks the booking "Needs manual assignment". Matching keeps trying in the meantime.

The numbers above are defaults in `src/assignment/assignment.config.ts`; the `ASSIGN_*` variables in `.env.example` override them.

The partner app reports its position with `PATCH /api/partner/me/location` while online, so distance uses where the professional is now.

### Scheduler

Vercel functions only run during a request, so something has to call the matcher when no app is polling. Without it an expired offer is not moved on until the customer or a professional next opens their app.

Set `CRON_SECRET` in the Vercel project, then have an external scheduler call this every minute:

```
GET https://<your-api>/api/cron/assignments
Authorization: Bearer <CRON_SECRET>
```

It expires lapsed offers, retries waiting bookings and flags the ones that have waited too long. Two free options:

- **cron-job.org**: create a job with the URL above, schedule "every 1 minute", and add the `Authorization` header under Advanced.
- **GitHub Actions**: a workflow with `on: schedule: - cron: '*/5 * * * *'` that runs `curl -H "Authorization: Bearer $CRON_SECRET" <url>`. GitHub's shortest interval is 5 minutes and runs can be delayed, so prefer cron-job.org.

## Place search

`GET /api/geo/search?q=&lat=&lng=` and `GET /api/geo/reverse?lat=&lng=` back the customer app's address form (`src/geo/`). They proxy [Photon](https://photon.komoot.io) (OpenStreetMap data), limited to India, and return one shape: `{ title, subtitle, lat, lng, street, city, state, zip }`.

The public Photon server is free and has no key, but it is a shared service with no uptime promise. If search traffic grows, host Photon yourself and set `GEO_PHOTON_URL`. The apps never call the provider directly, so it can be replaced in `geo.service.ts` alone.

## Deploying to Vercel

Create a Vercel project pointing at this folder (push it to its own repo first). `vercel.json` builds with `npm run vercel-build` and serves every path from `api/index.js`, in region `bom1` with maxDuration 30s.

Set `DATABASE_URL` to a **pooled** connection string. If migrations need a separate direct connection, set `DIRECT_URL` too.

## Checks

```bash
npm run build
npm run check:circular        # madge: no circular imports
```

End-to-end checks run against a running API and a **local** Postgres (they refuse any other database):

```bash
# API: NODE_ENV=development PAYMENT_MOCK=true OTP_DEV_ECHO=true CRON_SECRET=e2e DATABASE_URL=<local> npm start
npm run e2e:quote             # booking -> offer -> quote -> payment -> completion
npm run e2e:assign            # matching rules, escalation, cron, place search (needs CRON_SECRET=e2e)
```
