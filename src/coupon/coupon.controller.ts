import { Controller, Delete, Get, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../common/guards/admin-only.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { CouponService } from './coupon.service';

// Public list for the Offers screen; validate needs a user (per-user limits); writes are admin-only.
@Controller('api/coupons')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Get()
  async listCoupons(@Res() res: Response) {
    const coupons = await this.couponService.listActive();
    res.status(200).json({ status: 'success', results: coupons.length, data: { coupons } });
  }

  @Get('admin/all')
  @AdminOnly()
  async listAllCoupons(@Res() res: Response) {
    const coupons = await this.couponService.listAll();
    res.status(200).json({ status: 'success', results: coupons.length, data: { coupons } });
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  async validateCoupon(@Req() req: Request, @Res() res: Response) {
    const { code, amount } = req.body;
    logger.info('Validating coupon', { code, userId: req.user.id });

    const result = await this.couponService.validate(code, amount, req.user.id);

    res.status(200).json({ status: 'success', data: result });
  }

  @Post()
  @AdminOnly()
  async createCoupon(@Req() req: Request, @Res() res: Response) {
    const coupon = await this.couponService.createCoupon(req.body);
    res.status(201).json({ status: 'success', data: { coupon } });
  }

  @Put(':id')
  @AdminOnly()
  async updateCoupon(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    assertUuid(id, 'coupon');
    const coupon = await this.couponService.updateCoupon(id, req.body);
    res.status(200).json({ status: 'success', data: { coupon } });
  }

  @Delete(':id')
  @AdminOnly()
  async deleteCoupon(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    assertUuid(id, 'coupon');
    await this.couponService.deleteCoupon(id);
    res.status(200).json({ status: 'success', data: null });
  }
}
