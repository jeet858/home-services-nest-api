import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { CouponModule } from '../coupon/coupon.module';
import { EmailModule } from '../email/email.module';
import { JobModule } from '../job/job.module';
import { PaymentModule } from '../payment/payment.module';
import { ServiceProviderModule } from '../service-provider/service-provider.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

// Bookings (/api/booking). Assignment and Job handle matching and the inspection/quote/payment lifecycle.
@Module({
  imports: [ServiceProviderModule, EmailModule, CouponModule, PaymentModule, AssignmentModule, JobModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
