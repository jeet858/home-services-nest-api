import { Injectable } from '@nestjs/common';
import appConfig from '../config/app.config';
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { isForeignKeyError, orNull } from '../common/utils/prisma-errors';
import { FieldSpec, pickFields, requireFields } from '../common/validation/model-input';
import { PrismaService } from '../prisma/prisma.service';

// `subservices` is no longer writable here; the link lives on Subservice.serviceId.
const SERVICE_FIELDS: FieldSpec = {
  name: 'string',
  description: 'string',
  process: 'string',
  originalPrice: 'number',
  discountedPrice: 'number',
  duration: 'string',
  image: 'string',
};

@Injectable()
export class ServiceService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllServices(page = 1, limit = appConfig.pagination.defaultLimit) {
    try {
      logger.info('Fetching all services', { page, limit });

      const skip = (page - 1) * limit;
      const services = await this.prisma.service.findMany({
        include: { subservices: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.service.count();

      logger.info('Services fetched successfully', { count: services.length, total, page, limit });

      return { services, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Error fetching services', { error: error.message, page, limit });
      throw new DatabaseError('Failed to fetch services');
    }
  }

  async getService(serviceId: string) {
    try {
      logger.info('Fetching service by ID', { serviceId });

      const service = await this.prisma.service.findUnique({ where: { id: serviceId }, include: { subservices: true } });

      if (!service) {
        logger.warn('Service not found', { serviceId });
        throw new NotFoundError('Service not found');
      }

      logger.info('Service fetched successfully', { serviceId });
      return service;
    } catch (error) {
      logger.error('Error fetching service', { error: error.message, serviceId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch service');
    }
  }

  async createService(serviceData: Record<string, any>) {
    try {
      logger.info('Creating new service', { serviceData });

      const data = pickFields(serviceData, SERVICE_FIELDS);
      requireFields(data, ['name', 'originalPrice', 'discountedPrice', 'duration'], 'Service');

      const service = await this.prisma.service.create({ data: data as any });
      logger.info('Service created successfully', { serviceId: service.id });
      return service;
    } catch (error) {
      logger.error('Error creating service', { error: error.message, serviceData });

      if (error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to create service');
    }
  }

  async updateService(serviceId: string, updateData: Record<string, any>) {
    try {
      logger.info('Updating service', { serviceId, updateData });

      const service = await orNull(
        this.prisma.service.update({
          where: { id: serviceId },
          data: pickFields(updateData, SERVICE_FIELDS),
          include: { subservices: true },
        }),
      );

      if (!service) {
        logger.warn('Service not found for update', { serviceId });
        throw new NotFoundError('Service not found');
      }

      logger.info('Service updated successfully', { serviceId });
      return service;
    } catch (error) {
      logger.error('Error updating service', { error: error.message, serviceId, updateData });

      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to update service');
    }
  }

  async deleteService(serviceId: string) {
    try {
      logger.info('Deleting service', { serviceId });

      // Cascades to its subservices; blocked while ratings reference it.
      const service = await orNull(this.prisma.service.delete({ where: { id: serviceId } }));

      if (!service) {
        logger.warn('Service not found for deletion', { serviceId });
        throw new NotFoundError('Service not found');
      }

      logger.info('Service deleted successfully', { serviceId });
      return service;
    } catch (error) {
      logger.error('Error deleting service', { error: error.message, serviceId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      if (isForeignKeyError(error)) {
        throw new ConflictError('Cannot delete service: it has ratings');
      }

      throw new DatabaseError('Failed to delete service');
    }
  }
}
