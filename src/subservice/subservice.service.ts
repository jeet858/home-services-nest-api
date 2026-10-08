import { Injectable } from '@nestjs/common';
import appConfig from '../config/app.config';
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { isUuid } from '../common/utils/ids';
import { isForeignKeyError, orNull } from '../common/utils/prisma-errors';
import { FieldSpec, pickFields } from '../common/validation/model-input';
import { PrismaService } from '../prisma/prisma.service';

const CREATE_FIELDS: FieldSpec = {
  name: 'string',
  serviceId: 'string',
  description: 'string',
  process: 'string',
  image: 'string',
  originalPrice: 'number',
  discountedPrice: 'number',
  duration: 'string',
};
const UPDATE_FIELDS: FieldSpec = {
  name: 'string',
  description: 'string',
  process: 'string',
  originalPrice: 'number',
  discountedPrice: 'number',
  duration: 'string',
};
// Was populate('serviceId', 'name description').
const SERVICE_SUMMARY = { select: { id: true, name: true, description: true } };

@Injectable()
export class SubserviceService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllSubservices(page = 1, limit = appConfig.pagination.defaultLimit) {
    try {
      logger.info('Fetching all subservices', { page, limit });

      const skip = (page - 1) * limit;
      const subservices = await this.prisma.subservice.findMany({
        include: { service: SERVICE_SUMMARY },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.subservice.count();

      logger.info('Subservices fetched successfully', { count: subservices.length, total, page, limit });

      return { subservices, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Error fetching subservices', { error: error.message, page, limit });
      throw new DatabaseError('Failed to fetch subservices');
    }
  }

  async getSubservice(subserviceId: string) {
    try {
      logger.info('Fetching subservice by ID', { subserviceId });

      const subservice = await this.prisma.subservice.findUnique({
        where: { id: subserviceId },
        include: { service: SERVICE_SUMMARY },
      });

      if (!subservice) {
        logger.warn('Subservice not found', { subserviceId });
        throw new NotFoundError('Subservice not found');
      }

      logger.info('Subservice fetched successfully', { subserviceId });
      return subservice;
    } catch (error) {
      logger.error('Error fetching subservice', { error: error.message, subserviceId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch subservice');
    }
  }

  async createSubservice(subserviceData: Record<string, any>) {
    try {
      logger.info('Creating new subservice', { subserviceData });

      const requiredFields = ['name', 'serviceId', 'originalPrice', 'discountedPrice', 'duration'];
      const missingFields = requiredFields.filter((field) => !subserviceData[field]);

      if (missingFields.length > 0) {
        throw new ValidationError(`Missing required fields: ${missingFields.join(', ')}`);
      }

      const service = isUuid(subserviceData.serviceId)
        ? await this.prisma.service.findUnique({ where: { id: subserviceData.serviceId } })
        : null;
      if (!service) {
        throw new NotFoundError('Service not found');
      }

      const subservice = await this.prisma.subservice.create({ data: pickFields(subserviceData, CREATE_FIELDS) as any });
      logger.info('Subservice created successfully', { subserviceId: subservice.id });
      return subservice;
    } catch (error) {
      logger.error('Error creating subservice', { error: error.message, subserviceData });

      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to create subservice');
    }
  }

  async updateSubservice(subserviceId: string, updateData: Record<string, any>) {
    try {
      logger.info('Updating subservice', { subserviceId, updateData });

      const filteredData = pickFields(updateData, UPDATE_FIELDS);

      if (Object.keys(filteredData).length === 0) {
        throw new ValidationError('No valid fields to update');
      }

      const subservice = await orNull(
        this.prisma.subservice.update({
          where: { id: subserviceId },
          data: filteredData,
          include: { service: SERVICE_SUMMARY },
        }),
      );

      if (!subservice) {
        logger.warn('Subservice not found for update', { subserviceId });
        throw new NotFoundError('Subservice not found');
      }

      logger.info('Subservice updated successfully', { subserviceId });
      return subservice;
    } catch (error) {
      logger.error('Error updating subservice', { error: error.message, subserviceId, updateData });

      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to update subservice');
    }
  }

  async deleteSubservice(subserviceId: string) {
    try {
      logger.info('Deleting subservice', { subserviceId });

      const subservice = await orNull(this.prisma.subservice.delete({ where: { id: subserviceId } }));

      if (!subservice) {
        logger.warn('Subservice not found for deletion', { subserviceId });
        throw new NotFoundError('Subservice not found');
      }

      logger.info('Subservice deleted successfully', { subserviceId });
      return subservice;
    } catch (error) {
      logger.error('Error deleting subservice', { error: error.message, subserviceId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      if (isForeignKeyError(error)) {
        throw new ConflictError('Cannot delete subservice: it has ratings');
      }

      throw new DatabaseError('Failed to delete subservice');
    }
  }

  async getSubservicesByService(serviceId: string) {
    try {
      logger.info('Fetching subservices by service', { serviceId });

      const subservices = await this.prisma.subservice.findMany({ where: { serviceId }, orderBy: { createdAt: 'desc' } });

      logger.info('Subservices fetched successfully', { count: subservices.length, serviceId });

      return subservices;
    } catch (error) {
      logger.error('Error fetching subservices by service', { error: error.message, serviceId });
      throw new DatabaseError('Failed to fetch subservices');
    }
  }
}
