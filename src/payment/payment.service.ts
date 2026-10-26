import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import appConfig from '../config/app.config';
import { ExternalServiceError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';

// Talks to the Razorpay REST API directly; no SDK needed for orders + signature checks.
@Injectable()
export class PaymentService {
  private credentials() {
    const { keyId, keySecret } = appConfig.razorpay;
    if (!keyId || !keySecret) throw new ExternalServiceError('Online payments are not configured', 'razorpay');
    return { keyId, keySecret };
  }

  async createOrder(amount: unknown, userId: string) {
    const rupees = Number(amount);
    if (Number.isNaN(rupees) || rupees < 1) throw new ValidationError('A valid amount is required');
    const { keyId, keySecret } = this.credentials();

    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        amount: Math.round(rupees * 100),
        currency: 'INR',
        receipt: `bk_${Date.now()}`,
        notes: { userId },
      }),
    });

    if (!res.ok) {
      logger.error('Razorpay order creation failed', { status: res.status, body: await res.text() });
      throw new ExternalServiceError('Could not start payment, please try again', 'razorpay');
    }

    const order = (await res.json()) as { id: string; amount: number; currency: string };
    logger.info('Razorpay order created', { orderId: order.id, userId });
    return { orderId: order.id, amount: order.amount, currency: order.currency, keyId };
  }

  isValidSignature(orderId: unknown, paymentId: unknown, signature: unknown) {
    if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof signature !== 'string') return false;
    const expected = createHmac('sha256', this.credentials().keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  verify(orderId: unknown, paymentId: unknown, signature: unknown) {
    if (!this.isValidSignature(orderId, paymentId, signature)) {
      throw new ValidationError('Payment verification failed');
    }
  }
}
