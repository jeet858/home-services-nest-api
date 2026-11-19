import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { PaymentModule } from '../payment/payment.module';
import { StorageModule } from '../storage/storage.module';
import { JobService } from './job.service';

// Visit, quote, payment and work lifecycle, shared by the customer (/api/booking) and partner (/api/partner) APIs.
@Module({
  imports: [AssignmentModule, PaymentModule, StorageModule],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}
