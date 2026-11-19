-- Scored auto-assignment: audit fields, escalation flag and guards against duplicate open offers.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "matchEscalatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BookingAssignment" ADD COLUMN "distanceKm" DOUBLE PRECISION,
ADD COLUMN "score" DOUBLE PRECISION;

-- Clear leftovers so the unique indexes below can be built: lapsed offers expire,
-- and of any duplicate open offers only the newest survives.
UPDATE "BookingAssignment" SET "status" = 'expired', "respondedAt" = NOW()
WHERE "status" = 'offered' AND "expiresAt" < NOW();

UPDATE "BookingAssignment" a SET "status" = 'cancelled', "respondedAt" = NOW()
WHERE a."status" = 'offered' AND EXISTS (
  SELECT 1 FROM "BookingAssignment" b
  WHERE b."status" = 'offered' AND b."id" <> a."id" AND b."createdAt" > a."createdAt"
    AND (b."bookingId" = a."bookingId" OR b."providerId" = a."providerId")
);

-- A booking has at most one open offer, and a professional holds at most one.
CREATE UNIQUE INDEX "BookingAssignment_one_open_offer_per_booking" ON "BookingAssignment"("bookingId") WHERE "status" = 'offered';
CREATE UNIQUE INDEX "BookingAssignment_one_open_offer_per_provider" ON "BookingAssignment"("providerId") WHERE "status" = 'offered';
