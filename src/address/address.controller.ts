import { Controller, Delete, Get, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { AddressService } from './address.service';

// router.use(verifyToken) -> class-level guard. Note: admin/:addressId was never admin-guarded.
@Controller('api/addresses')
@UseGuards(JwtAuthGuard)
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Post()
  async createAddress(@Req() req: Request, @Res() res: Response) {
    const addressData = req.body;
    const userId = req.user.id;
    logger.info('Creating new address', { userId });

    const address = await this.addressService.createAddress(addressData, userId);

    res.status(201).json({ status: 'success', data: { address } });
  }

  @Get()
  async getAllAddresses(@Req() req: Request, @Res() res: Response) {
    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 5;

    logger.info('Getting all addresses', { userId, page, limit });

    const result = await this.addressService.getAllAddresses(userId, page, limit);

    res.status(200).json({
      status: 'success',
      results: result.addresses.length,
      pagination: result.pagination,
      data: { addresses: result.addresses },
    });
  }

  @Get(':addressId')
  async getAddress(@Req() req: Request, @Res() res: Response) {
    const { addressId } = req.params;
    const userId = req.user.id;
    logger.info('Getting address by ID', { addressId, userId });
    assertUuid(addressId, 'address');

    const address = await this.addressService.getAddress(addressId, userId);

    res.status(200).json({ status: 'success', data: { address } });
  }

  @Get('admin/:addressId')
  async getAddressForAdmin(@Req() req: Request, @Res() res: Response) {
    const { addressId } = req.params;
    logger.info('Getting address by ID', { addressId });
    assertUuid(addressId, 'address');

    const address = await this.addressService.getAddressForAdmin(addressId);

    res.status(200).json({ status: 'success', data: { address } });
  }

  @Put(':addressId')
  async updateAddress(@Req() req: Request, @Res() res: Response) {
    const { addressId } = req.params;
    const userId = req.user.id;
    const updateData = req.body;
    logger.info('Updating address', { addressId, userId });
    assertUuid(addressId, 'address');

    const address = await this.addressService.updateAddress(addressId, userId, updateData);

    res.status(200).json({ status: 'success', data: { address } });
  }

  @Delete(':addressId')
  async deleteAddress(@Req() req: Request, @Res() res: Response) {
    const { addressId } = req.params;
    const userId = req.user.id;
    logger.info('Deleting address', { addressId, userId });
    assertUuid(addressId, 'address');

    const response = await this.addressService.deleteAddress(addressId, userId);

    res.status(200).json({ status: 'success', data: response });
  }
}
