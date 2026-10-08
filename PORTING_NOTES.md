# Porting notes: Express + MongoDB → NestJS + Prisma + PostgreSQL

This folder is a port of `../home-services-API/src`. Routes, guards, route order, status codes, validation messages and response envelopes match the original, except for the changes listed below. In the code, each fix is marked with a `// fix:` comment.

## Intentional contract changes

| Area | Before | Now |
|---|---|---|
| Entity ids | Mongo `_id` (ObjectId) | `id` (UUID) |
| Relations in payloads | populated object replaced the id field (`addressId: {...}`) | scalar FK stays (`addressId`), relation is a separate key (`address`, `serviceProvider`, `service`, `assignedBy`, …) |
| Provider sub-documents in raw entity payloads | `aadhaarCard`, `panCard`, `bankDetails`, `rating` objects | flat columns (`aadhaarNumber`, `ratingAverage`, …). Hand-built controller envelopes still return the nested objects. |
| `__v`, `Service.subservices` id array | present | gone; a service's subservices come from `Subservice.serviceId` |
| Existing JWTs | ObjectId in `id` claim | **rejected (401 "Invalid token")**. Users and admins must log in again after migration. |
| Unknown path under a protected prefix | 401 (router-level `verifyToken`) | 404 (per-route guards) |

## Bug fixes

- **Security:** clients could `PUT /api/users/profile {role:"admin"}`, then log in at `/api/admin/login` with password `Not Required`. `role` is no longer writable.
- **Security:** admin login and create returned the password. It is now omitted.
- **Security:** users could update their own rating's `status` (skipping review). Only `rating` and `feedback` are writable now.
- **Security:** users could set `serviceProviderId`, `assignedAt` and `assignedBy` on their bookings. These are admin-only now.
- **Security:** `$regex` provider search used raw user input (injection/ReDoS). It now uses a case-insensitive `contains`.
- **Security:** `console.log` calls that dumped provider Aadhaar/PAN data are removed.
- The admin controller used `req.user._id`, which is never set. The self-deletion guard never fired and `createdBy` was undefined.
- `appConfig.pagination.defaultLimit` was undefined. Now it is `10`.
- Expired JWTs returned "Invalid token", because the `JsonWebTokenError` check ran first. They now return "Token expired".
- Malformed JSON, bodies over 10kb and Multer limit errors returned 500. They now return 400/413.
- On Vercel, all clients shared one rate-limit bucket (the proxy IP). `trust proxy` is now set when `VERCEL` is set.
- `POST /api/service-providers/available` always returned 500 (`weekday: 'lowercase'` is not a valid option). The unused weekday lookup is removed.
- Provider duplicate checks matched any provider when a field was missing, because Mongoose dropped `undefined` filters. Missing fields now produce a 400.
- `verificationStatus=pending` together with `search` silently lost the verification filter (one `$or` overwrote the other). The two are now combined.
- `canHandleService` used `Array.includes` on ObjectIds and never matched.
- Rating creation made one rating per subservice, but `unique(booking)` made the second insert fail, leaving a partial write. The constraint is now `unique(booking, subservice)`, inside a transaction.
- Approving a rating and updating the provider's stats are now one transaction.
- `lastLogin`, `cancellationReason` and `cancelledAt` were written but dropped by the schema. They are real columns now.
- Missing required fields now return 400. Before, Mongoose `ValidationError`s were mostly wrapped into a 500 `DatabaseError`.
- Malformed ids (path params) return 400 `Invalid <entity> id` instead of a CastError 500.
- Non-numeric `page`/`limit` on ratings and provider lists fall back to the defaults instead of returning a 500.
- Service/subservice/provider ids in bodies must exist (FKs). Before, dangling ids were stored silently.

## Additions after the port

- **Addresses have optional `lat`/`lng`** (Postgres `double precision`, NULL when not sent). The API casts them to numbers and rejects out-of-range values with 400. The Mongo migration copies them when present.
- **Storage moved from S3 to Supabase Storage** (public bucket). Uploads now happen in `StorageService` after multer buffers the file in memory. Before, multer-s3 streamed them during parsing. The file filter, size limits, key layout and the `File upload failed: …` error are unchanged.
  - The `aadhaarS3Key`, `panS3Key` and `passportPhotoS3Key` columns and the `s3Key` request fields keep their names; they now hold Supabase object keys.
  - Image URLs copied over from Mongo still point at the old S3 bucket (`homeservice27`). Copy those files to Supabase and rewrite the URLs if you are retiring S3.

## Behaviour differences you may notice

- Deleting a **user** cascades to their addresses, bookings and ratings. Mongo left them orphaned.
- Deleting a **service** cascades to its subservices. It is blocked with a 409 while ratings reference it or its subservices.
- Deleting a **provider** or **admin** keeps bookings and ratings, with the reference set to NULL.
- Replacing a provider's Aadhaar/PAN number or image resets that card's `verified` flag, which matches the old whole-sub-document `$set`. The rest of the provider update merges fields.
- Ratings must be integers 1–5. Fractional ratings used to be accepted and broke the distribution counts.
- `admin/:addressId` still only requires a login, not admin. That's unchanged, but see below.

## Flagged, not changed (needs a decision)

- Admin passwords are stored and compared **in plaintext**.
- User and admin JWTs have **no expiry**. `JWT_EXPIRY` exists but is unused.
- The SMS gateway credentials were hardcoded. They are now `SMS_*` env vars that fall back to the old values. **Rotate them.**
- Non-admins get 401 (not 403) on admin routes.
- `GET /api/addresses/admin/:addressId` lets any logged-in user read any address.
- Approving an already-approved rating counts it again in provider stats.
- User JWTs carry no `role`. Only admin tokens pass `AdminGuard`.

## Architecture

- `PrismaModule` is `@Global`. Every service injects `PrismaService` directly, so feature modules never import each other just for data access.
- There are only two feature → feature edges:
  - `BookingModule → ServiceProviderModule`
  - `ServiceProviderModule → StorageModule`
- Model methods and hooks are pure functions in `service-provider.domain.ts`.
- `npm run check:circular` runs madge. It must report no cycles, and there is no `forwardRef` anywhere.
