import { Module } from '@nestjs/common';
import { AddressModule } from './address/address.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BookingModule } from './booking/booking.module';
import { CouponModule } from './coupon/coupon.module';
import { GeoModule } from './geo/geo.module';
import { HealthModule } from './health/health.module';
import { PaymentModule } from './payment/payment.module';
import { RatingModule } from './rating/rating.module';
import { ServiceProviderModule } from './service-provider/service-provider.module';
import { ServiceModule } from './service/service.module';
import { StorageModule } from './storage/storage.module';
import { SubserviceModule } from './subservice/subservice.module';
import { UserModule } from './user/user.module';
import { PrismaModule } from './prisma/prisma.module';
import { AssignmentModule } from './assignment/assignment.module';
import { JobModule } from './job/job.module';
import { NotificationModule } from './notification/notification.module';
import { PartnerModule } from './partner/partner.module';

// Mirrors the route mounts in src/app.js.
@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    UserModule,
    AddressModule,
    GeoModule,
    ServiceModule,
    AdminModule,
    SubserviceModule,
    BookingModule,
    RatingModule,
    ServiceProviderModule,
    CouponModule,
    PaymentModule,
    StorageModule,
    NotificationModule,
    AssignmentModule,
    JobModule,
    PartnerModule,
  ],
})
export class AppModule {}
