import { Controller, Delete, Get, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../common/guards/admin-only.decorator';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { ServiceService } from './service.service';

// Public reads; writes sit behind router.use(verifyToken, isAdmin) -> @AdminOnly.
@Controller('api/services')
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  @Get()
  async getAllServices(@Req() req: Request, @Res() res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    logger.info('Getting all services', { page, limit });

    const result = await this.serviceService.getAllServices(page, limit);

    res.status(200).json({
      status: 'success',
      results: result.services.length,
      pagination: result.pagination,
      data: { services: result.services },
    });
  }

  @Get(':id')
  async getService(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Getting service by ID', { serviceId: id });
    assertUuid(id, 'service');

    const service = await this.serviceService.getService(id);

    res.status(200).json({ status: 'success', data: { service } });
  }

  @Post()
  @AdminOnly()
  async createService(@Req() req: Request, @Res() res: Response) {
    const serviceData = req.body;
    logger.info('Creating new service');

    const service = await this.serviceService.createService(serviceData);

    res.status(201).json({ status: 'success', data: { service } });
  }

  @Put(':id')
  @AdminOnly()
  async updateService(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const updateData = req.body;
    logger.info('Updating service', { serviceId: id });
    assertUuid(id, 'service');

    const service = await this.serviceService.updateService(id, updateData);

    res.status(200).json({ status: 'success', data: { service } });
  }

  @Delete(':id')
  @AdminOnly()
  async deleteService(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Deleting service', { serviceId: id });
    assertUuid(id, 'service');

    await this.serviceService.deleteService(id);

    res.status(200).json({ status: 'success', data: null });
  }
}
