import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { logger } from '../common/logger/logger';
import { PaymentService } from './payment.service';

@Controller('api/payments')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('order')
  async createOrder(@Req() req: Request, @Res() res: Response) {
    logger.info('Creating payment order', { userId: req.user.id });
    const order = await this.paymentService.createOrder(req.body.amount, req.user.id);
    res.status(201).json({ status: 'success', data: order });
  }

  @Post('verify')
  async verifyPayment(@Req() req: Request, @Res() res: Response) {
    const { orderId, paymentId, signature } = req.body;
    this.paymentService.verify(orderId, paymentId, signature);
    res.status(200).json({ status: 'success', data: { verified: true } });
  }
}
