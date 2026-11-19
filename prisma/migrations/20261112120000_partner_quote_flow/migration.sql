-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('customer', 'provider');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('not_added', 'pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "BookingItemStatus" AS ENUM ('booked', 'proposed', 'accepted', 'rejected', 'countered', 'declined', 'not_needed');

-- CreateEnum
CREATE TYPE "NegotiationParty" AS ENUM ('provider', 'customer');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('offered', 'accepted', 'rejected', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('visit', 'quote');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('user', 'provider');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('scheduled', 'processing', 'paid', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'searching';
ALTER TYPE "BookingStatus" ADD VALUE 'offered';
ALTER TYPE "BookingStatus" ADD VALUE 'accepted';
ALTER TYPE "BookingStatus" ADD VALUE 'on_the_way';
ALTER TYPE "BookingStatus" ADD VALUE 'arrived';
ALTER TYPE "BookingStatus" ADD VALUE 'inspecting';
ALTER TYPE "BookingStatus" ADD VALUE 'quote_sent';
ALTER TYPE "BookingStatus" ADD VALUE 'payment_pending';
ALTER TYPE "BookingStatus" ADD VALUE 'in_progress';

-- DropIndex
DROP INDEX "Otp_phoneNumber_idx";

-- AlterTable
ALTER TABLE "Otp" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purpose" "OtpPurpose" NOT NULL DEFAULT 'customer';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "afterPhotos" TEXT[],
ADD COLUMN     "agreedTotal" DOUBLE PRECISION,
ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "cashConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "commissionAmount" DOUBLE PRECISION,
ADD COLUMN     "commissionPct" DOUBLE PRECISION,
ADD COLUMN     "estimatedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "inspectionAt" TIMESTAMP(3),
ADD COLUMN     "issuePhotos" TEXT[],
ADD COLUMN     "onTheWayAt" TIMESTAMP(3),
ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerEarning" DOUBLE PRECISION,
ADD COLUMN     "quoteApprovedAt" TIMESTAMP(3),
ADD COLUMN     "quoteNote" TEXT,
ADD COLUMN     "quoteRound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quoteSentAt" TIMESTAMP(3),
ADD COLUMN     "visitChargePaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visitingCharge" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ServiceProvider" ADD COLUMN     "fcmToken" TEXT,
ADD COLUMN     "isOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ProviderDocument" ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "status" "DocumentStatus" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "BookingItem" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "subserviceId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "catalogPrice" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "finalPrice" DOUBLE PRECISION,
    "isAdditional" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "status" "BookingItemStatus" NOT NULL DEFAULT 'booked',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemNegotiation" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "by" "NegotiationParty" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemNegotiation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAssignment" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'offered',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "bookingId" UUID,
    "userId" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "recipientType" "RecipientType" NOT NULL,
    "recipientId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bookingId" UUID,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'scheduled',
    "utr" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingItem_bookingId_sortOrder_idx" ON "BookingItem"("bookingId", "sortOrder");

-- CreateIndex
CREATE INDEX "ItemNegotiation_itemId_round_idx" ON "ItemNegotiation"("itemId", "round");

-- CreateIndex
CREATE INDEX "BookingAssignment_providerId_status_idx" ON "BookingAssignment"("providerId", "status");

-- CreateIndex
CREATE INDEX "BookingAssignment_bookingId_status_idx" ON "BookingAssignment"("bookingId", "status");

-- CreateIndex
CREATE INDEX "BookingAssignment_status_expiresAt_idx" ON "BookingAssignment"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "Payment_userId_kind_status_idx" ON "Payment"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX "Notification_recipientType_recipientId_createdAt_idx" ON "Notification"("recipientType", "recipientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_recipientType_recipientId_readAt_idx" ON "Notification"("recipientType", "recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Payout_providerId_createdAt_idx" ON "Payout"("providerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Otp_phoneNumber_purpose_idx" ON "Otp"("phoneNumber", "purpose");

-- CreateIndex
CREATE INDEX "Booking_status_createdAt_idx" ON "Booking"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceProvider_status_isOnline_idx" ON "ServiceProvider"("status", "isOnline");

-- AddForeignKey
ALTER TABLE "BookingItem" ADD CONSTRAINT "BookingItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingItem" ADD CONSTRAINT "BookingItem_subserviceId_fkey" FOREIGN KEY ("subserviceId") REFERENCES "Subservice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemNegotiation" ADD CONSTRAINT "ItemNegotiation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BookingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAssignment" ADD CONSTRAINT "BookingAssignment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAssignment" ADD CONSTRAINT "BookingAssignment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ServiceProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing documents keep their verification state.
UPDATE "ProviderDocument" SET "status" = 'verified' WHERE "verified" = true;
