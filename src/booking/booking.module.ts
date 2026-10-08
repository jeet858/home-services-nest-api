import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { ServiceProviderModule } from '../service-provider/service-provider.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

// Bookings (/api/booking). One-way dependencies on ServiceProviderModule (provider assignment) and EmailModule (notifications).
@Module({
  imports: [ServiceProviderModule, EmailModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
