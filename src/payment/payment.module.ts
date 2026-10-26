import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

// Razorpay orders and verification (/api/payments). Exported so bookings can verify before marking paid.
@Module({ controllers: [PaymentController], providers: [PaymentService], exports: [PaymentService] })
export class PaymentModule {}
