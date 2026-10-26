import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { FieldSpec, pickFields, requireFields } from '../common/validation/model-input';
import { Coupon } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const COUPON_FIELDS: FieldSpec = {
  code: 'string',
  title: 'string',
  description: 'string',
  tag: 'string',
  type: 'string',
  value: 'number',
  maxDiscount: 'number',
  minOrder: 'number',
  validTill: 'date',
  perUserLimit: 'int',
  active: 'boolean',
};
const TYPES = ['percent', 'flat', 'cashback'];

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  private toCouponData(input: Record<string, any>) {
    const data = pickFields(input, COUPON_FIELDS);
    if (data.code !== undefined) data.code = String(data.code).trim().toUpperCase();
    if (data.type !== undefined && !TYPES.includes(data.type)) {
      throw new ValidationError(`Coupon type must be one of ${TYPES.join(', ')}`);
    }
    return data;
  }

  // Cashback coupons don't reduce the bill; they're credited after the job.
  computeDiscount(coupon: Coupon, amount: number) {
    if (coupon.type === 'cashback') return 0;
    let discount = coupon.type === 'percent' ? (amount * coupon.value) / 100 : coupon.value;
    if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
    return Math.round(Math.min(discount, amount));
  }

  // Admin view: every coupon, including inactive and expired ones.
  async listAll() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async listActive() {
    return this.prisma.coupon.findMany({
      where: { active: true, OR: [{ validTill: null }, { validTill: { gte: new Date() } }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Throws a 400 with a user-facing message when the code can't be applied.
  async validate(code: unknown, amount: unknown, userId: string) {
    if (!code || typeof code !== 'string') throw new ValidationError('Coupon code is required');
    const total = Number(amount);
    if (Number.isNaN(total) || total <= 0) throw new ValidationError('A valid order amount is required');

    const coupon = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!coupon || !coupon.active) throw new ValidationError('Invalid coupon code');
    if (coupon.validTill && coupon.validTill < new Date()) throw new ValidationError('This coupon has expired');
    if (total < coupon.minOrder) throw new ValidationError(`Add items worth ₹${Math.ceil(coupon.minOrder - total)} more to use this coupon`);

    if (coupon.perUserLimit != null) {
      const used = await this.prisma.booking.count({
        where: { userId, couponCode: coupon.code, status: { not: 'cancelled' } },
      });
      if (used >= coupon.perUserLimit) throw new ValidationError('You have already used this coupon');
    }

    const discount = this.computeDiscount(coupon, total);
    logger.info('Coupon validated', { code: coupon.code, userId, amount: total, discount });
    return { coupon, discount };
  }

  async createCoupon(input: Record<string, any>) {
    const data = this.toCouponData(input);
    requireFields(data, ['code', 'title', 'type', 'value'], 'Coupon');
    if (await this.prisma.coupon.findUnique({ where: { code: data.code } })) {
      throw new ConflictError('Coupon code already exists');
    }
    return this.prisma.coupon.create({ data: data as any });
  }

  async updateCoupon(id: string, input: Record<string, any>) {
    if (!(await this.prisma.coupon.findUnique({ where: { id } }))) throw new NotFoundError('Coupon not found');
    return this.prisma.coupon.update({ where: { id }, data: this.toCouponData(input) });
  }

  async deleteCoupon(id: string) {
    if (!(await this.prisma.coupon.findUnique({ where: { id } }))) throw new NotFoundError('Coupon not found');
    await this.prisma.coupon.delete({ where: { id } });
  }
}
