import { Module } from '@nestjs/common';
import { AddressModule } from './address/address.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BookingModule } from './booking/booking.module';
import { CouponModule } from './coupon/coupon.module';
import { HealthModule } from './health/health.module';
import { PaymentModule } from './payment/payment.module';
import { RatingModule } from './rating/rating.module';
import { ServiceProviderModule } from './service-provider/service-provider.module';
import { ServiceModule } from './service/service.module';
import { StorageModule } from './storage/storage.module';
import { SubserviceModule } from './subservice/subservice.module';
import { UserModule } from './user/user.module';
import { PrismaModule } from './prisma/prisma.module';

// Mirrors the route mounts in src/app.js.
@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    UserModule,
    AddressModule,
    ServiceModule,
    AdminModule,
    SubserviceModule,
    BookingModule,
    RatingModule,
    ServiceProviderModule,
    CouponModule,
    PaymentModule,
    StorageModule,
  ],
})
export class AppModule {}
