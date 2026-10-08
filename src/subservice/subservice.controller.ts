import { Controller, Delete, Get, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../common/guards/admin-only.decorator';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { SubserviceService } from './subservice.service';

// Public reads; writes sit behind router.use(verifyToken, isAdmin) -> @AdminOnly.
@Controller('api/subservice')
export class SubserviceController {
  constructor(private readonly subserviceService: SubserviceService) {}

  @Get()
  async getAllSubservices(@Req() req: Request, @Res() res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    logger.info('Getting all subservices', { page, limit });

    const result = await this.subserviceService.getAllSubservices(page, limit);

    res.status(200).json({
      status: 'success',
      results: result.subservices.length,
      pagination: result.pagination,
      data: { subservices: result.subservices },
    });
  }

  @Get(':id')
  async getSubservice(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Getting subservice by ID', { subserviceId: id });
    assertUuid(id, 'subservice');

    const subservice = await this.subserviceService.getSubservice(id);

    res.status(200).json({ status: 'success', data: { subservice } });
  }

  @Get('service/:serviceId')
  async getSubservicesByService(@Req() req: Request, @Res() res: Response) {
    const { serviceId } = req.params;
    logger.info('Getting subservices by service', { serviceId });
    assertUuid(serviceId, 'service');

    const subservices = await this.subserviceService.getSubservicesByService(serviceId);

    res.status(200).json({ status: 'success', results: subservices.length, data: { subservices } });
  }

  @Post()
  @AdminOnly()
  async createSubservice(@Req() req: Request, @Res() res: Response) {
    const subserviceData = req.body;
    logger.info('Creating new subservice');

    const subservice = await this.subserviceService.createSubservice(subserviceData);

    res.status(201).json({ status: 'success', data: { subservice } });
  }

  @Put(':id')
  @AdminOnly()
  async updateSubservice(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const updateData = req.body;
    logger.info('Updating subservice', { subserviceId: id });
    assertUuid(id, 'subservice');

    const subservice = await this.subserviceService.updateSubservice(id, updateData);

    res.status(200).json({ status: 'success', data: { subservice } });
  }

  @Delete(':id')
  @AdminOnly()
  async deleteSubservice(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Deleting subservice', { subserviceId: id });
    assertUuid(id, 'subservice');

    await this.subserviceService.deleteSubservice(id);

    res.status(200).json({ status: 'success', data: null });
  }
}
