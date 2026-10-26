import { Module } from '@nestjs/common';
import { CouponModule } from '../coupon/coupon.module';
import { EmailModule } from '../email/email.module';
import { PaymentModule } from '../payment/payment.module';
import { ServiceProviderModule } from '../service-provider/service-provider.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

// Bookings (/api/booking). One-way dependencies on ServiceProviderModule (provider assignment), EmailModule (notifications), CouponModule and PaymentModule (checkout).
@Module({
  imports: [ServiceProviderModule, EmailModule, CouponModule, PaymentModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
