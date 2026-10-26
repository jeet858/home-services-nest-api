import { Module } from '@nestjs/common';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';

// Promo codes (/api/coupons). Exported so bookings can re-validate the applied code server-side.
@Module({ controllers: [CouponController], providers: [CouponService], exports: [CouponService] })
export class CouponModule {}
