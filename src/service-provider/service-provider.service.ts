import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { isUuid } from '../common/utils/ids';
import { requireFields } from '../common/validation/model-input';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyRatingStats,
  defaultAvailability,
  toProviderInput,
  updateVerificationStatus,
} from './service-provider.domain';

const SUMMARY = { select: { id: true, name: true, description: true } };
const NAME_ONLY = { select: { id: true, name: true } };
// Was populate('services'/'subservices'/'createdBy'/'verifiedBy'); certs/docs were embedded arrays.
const PROVIDER_INCLUDE = {
  services: SUMMARY,
  subservices: SUMMARY,
  createdBy: NAME_ONLY,
  verifiedBy: NAME_ONLY,
  certifications: true,
  documents: true,
} satisfies Prisma.ServiceProviderInclude;

const STATUSES = ['active', 'inactive', 'suspended', 'pending', 'verification_pending'];
// Matches nothing; used where Mongo would simply find no documents for a bad filter value.
const NO_MATCH = { id: { in: [] as string[] } };

@Injectable()
export class ServiceProviderService {
  constructor(private readonly prisma: PrismaService) {}

  private async findOrThrow(providerId: string) {
    const serviceProvider = await this.prisma.serviceProvider.findUnique({ where: { id: providerId } });
    if (!serviceProvider) {
      throw new NotFoundError('Service provider not found');
    }
    return serviceProvider;
  }

  // Unique-field checks from the original, skipping values that weren't supplied.
  // fix: Mongoose dropped undefined filters, so a missing phone/Aadhaar matched any provider and 409'd.
  private async assertUnique(data: Record<string, any>, excludeId?: string) {
    const checks: [string, string][] = [
      ['phoneNumber', 'Phone number already registered'],
      ['email', 'Email already registered'],
      ['aadhaarNumber', 'Aadhaar number already registered'],
      ['panNumber', 'PAN number already registered'],
    ];
    for (const [field, message] of checks) {
      if (data[field] === undefined || data[field] === null) continue;
      const existing = await this.prisma.serviceProvider.findFirst({
        where: { [field]: data[field], ...(excludeId && { id: { not: excludeId } }) },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError(message);
      }
    }
  }

  // fix: dangling service/subservice ids were stored silently; FKs now require them to exist.
  private async assertCatalogIds(serviceIds?: string[], subserviceIds?: string[]) {
    if (serviceIds?.length) {
      const found = await this.prisma.service.count({ where: { id: { in: serviceIds } } });
      if (found !== serviceIds.length) throw new ValidationError('One or more services not found');
    }
    if (subserviceIds?.length) {
      const found = await this.prisma.subservice.count({ where: { id: { in: subserviceIds } } });
      if (found !== subserviceIds.length) throw new ValidationError('One or more subservices not found');
    }
  }

  async createServiceProvider(providerData: Record<string, any>, adminId: string) {
    try {
      logger.info('Creating new service provider', { adminId });

      const input = toProviderInput(providerData);
      const serviceIds = input.serviceIds && [...new Set(input.serviceIds)];
      const subserviceIds = input.subserviceIds && [...new Set(input.subserviceIds)];
      requireFields(input.data, ['name', 'email', 'phoneNumber'], 'ServiceProvider');

      await this.assertUnique(input.data);
      await this.assertCatalogIds(serviceIds, subserviceIds);

      const data = updateVerificationStatus({
        aadhaarVerified: false,
        panVerified: false,
        ...input.data,
        status: 'verification_pending',
      } as any);

      const serviceProvider = await this.prisma.serviceProvider.create({
        data: {
          ...data,
          availability: data.availability ?? defaultAvailability(),
          createdById: adminId,
          services: serviceIds && { connect: serviceIds.map((id) => ({ id })) },
          subservices: subserviceIds && { connect: subserviceIds.map((id) => ({ id })) },
          certifications: input.certifications && { create: input.certifications as any },
          documents: input.documents && { create: input.documents as any },
        },
        include: PROVIDER_INCLUDE,
      });

      logger.info('Service provider created successfully', { providerId: serviceProvider.id, name: serviceProvider.name });

      return serviceProvider;
    } catch (error) {
      logger.error('Failed to create service provider', { error: error.message, adminId });
      throw error;
    }
  }

  async getAllServiceProviders(page = 1, limit = 10, filters: Record<string, any> = {}) {
    try {
      logger.info('Fetching all service providers', { page, limit, filters });

      const and: Prisma.ServiceProviderWhereInput[] = [];

      if (filters.status) {
        and.push(STATUSES.includes(filters.status) ? { status: filters.status } : NO_MATCH);
      }
      if (filters.service) {
        and.push(isUuid(filters.service) ? { services: { some: { id: filters.service } } } : NO_MATCH);
      }
      if (filters.subservice) {
        and.push(isUuid(filters.subservice) ? { subservices: { some: { id: filters.subservice } } } : NO_MATCH);
      }

      if (filters.verificationStatus === 'verified') {
        and.push({ aadhaarVerified: true, panVerified: true });
      } else if (filters.verificationStatus === 'pending') {
        and.push({ OR: [{ aadhaarVerified: false }, { panVerified: false }] });
      }

      // fix: user input went into $regex (injection/ReDoS); plain case-insensitive contains instead.
      // fix: combined with AND; previously search's $or overwrote the verificationStatus=pending $or.
      if (filters.search) {
        const contains = { contains: String(filters.search), mode: 'insensitive' as const };
        and.push({
          OR: [
            { name: contains },
            { email: contains },
            { phoneNumber: contains },
            { aadhaarNumber: contains },
            { panNumber: contains },
          ],
        });
      }

      const where = { AND: and };
      const skip = (page - 1) * limit;
      const serviceProviders = await this.prisma.serviceProvider.findMany({
        where,
        include: PROVIDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.serviceProvider.count({ where });

      logger.info('Service providers fetched successfully', { count: serviceProviders.length, total, page, limit });

      return {
        serviceProviders,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    } catch (error) {
      logger.error('Failed to fetch service providers', { error: error.message, page, limit });
      throw error;
    }
  }

  async getServiceProvider(providerId: string) {
    try {
      logger.info('Fetching service provider', { providerId });

      const serviceProvider = await this.prisma.serviceProvider.findUnique({
        where: { id: providerId },
        include: PROVIDER_INCLUDE,
      });

      if (!serviceProvider) {
        throw new NotFoundError('Service provider not found');
      }

      logger.info('Service provider fetched successfully', { providerId });
      return serviceProvider;
    } catch (error) {
      logger.error('Failed to fetch service provider', { error: error.message, providerId });
      throw error;
    }
  }

  async updateServiceProvider(providerId: string, updateData: Record<string, any>, adminId: string) {
    try {
      logger.info('Updating service provider', { providerId, adminId });

      await this.findOrThrow(providerId);

      const input = toProviderInput(updateData);
      const serviceIds = input.serviceIds && [...new Set(input.serviceIds)];
      const subserviceIds = input.subserviceIds && [...new Set(input.subserviceIds)];

      await this.assertUnique(input.data, providerId);
      await this.assertCatalogIds(serviceIds, subserviceIds);

      // Arrays are replaced wholesale, as $set did.
      const updatedProvider = await this.prisma.serviceProvider.update({
        where: { id: providerId },
        data: {
          ...(input.data as any),
          services: serviceIds && { set: serviceIds.map((id) => ({ id })) },
          subservices: subserviceIds && { set: subserviceIds.map((id) => ({ id })) },
          certifications: input.certifications && { deleteMany: {}, create: input.certifications as any },
          documents: input.documents && { deleteMany: {}, create: input.documents as any },
        },
        include: PROVIDER_INCLUDE,
      });

      logger.info('Service provider updated successfully', { providerId });
      return updatedProvider;
    } catch (error) {
      logger.error('Failed to update service provider', { error: error.message, providerId, adminId });
      throw error;
    }
  }

  async deleteServiceProvider(providerId: string, adminId: string) {
    try {
      logger.info('Deleting service provider', { providerId, adminId });

      await this.findOrThrow(providerId);

      const activeBookings = await this.prisma.booking.count({
        where: { serviceProviderId: providerId, status: { in: ['pending', 'confirmed'] } },
      });

      if (activeBookings > 0) {
        throw new ValidationError('Cannot delete service provider with active bookings');
      }

      // Past bookings/ratings keep their rows with serviceProviderId set to NULL.
      await this.prisma.serviceProvider.delete({ where: { id: providerId } });

      logger.info('Service provider deleted successfully', { providerId });
      return { message: 'Service provider deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete service provider', { error: error.message, providerId, adminId });
      throw error;
    }
  }

  async verifyServiceProvider(providerId: string, adminId: string, verificationData: Record<string, any> = {}) {
    try {
      logger.info('Verifying service provider', { providerId, adminId });

      const serviceProvider = await this.findOrThrow(providerId);

      // Only truthy flags are applied, as before.
      if (verificationData.verifyDocuments) {
        if (verificationData.verifyDocuments.aadhaarCard) {
          serviceProvider.aadhaarVerified = Boolean(verificationData.verifyDocuments.aadhaarCard);
        }
        if (verificationData.verifyDocuments.panCard) {
          serviceProvider.panVerified = Boolean(verificationData.verifyDocuments.panCard);
        }
      }

      return await this.saveVerification(serviceProvider, adminId, verificationData.notes);
    } catch (error) {
      logger.error('Failed to verify service provider', { error: error.message, providerId, adminId });
      throw error;
    }
  }

  async verifyDocuments(providerId: string, adminId: string, documentType: string, verified: any, notes?: string) {
    try {
      logger.info('Verifying service provider documents', { providerId, adminId, documentType, verified });

      const serviceProvider = await this.findOrThrow(providerId);

      // Mongoose cast the flag to Boolean.
      const flag = verified === true || verified === 'true' || verified === 1 || verified === '1';
      if (documentType === 'aadhaarCard') {
        serviceProvider.aadhaarVerified = flag;
      } else if (documentType === 'panCard') {
        serviceProvider.panVerified = flag;
      } else {
        throw new ValidationError('Invalid document type. Must be "aadhaarCard" or "panCard"');
      }

      const saved = await this.saveVerification(serviceProvider, adminId, notes);

      logger.info('Service provider documents verified successfully', { providerId, documentType, verified });
      return saved;
    } catch (error) {
      logger.error('Failed to verify service provider documents', { error: error.message, providerId, adminId, documentType });
      throw error;
    }
  }

  // Shared tail of verifyServiceProvider/verifyDocuments (status rule + save hook).
  private async saveVerification(p: any, adminId: string, notes?: string) {
    p.status = p.aadhaarVerified && p.panVerified ? 'active' : 'verification_pending';
    if (notes && notes.length > 500) {
      throw new ValidationError('ServiceProvider validation failed: notes: must not exceed 500 characters');
    }
    updateVerificationStatus(p);

    const saved = await this.prisma.serviceProvider.update({
      where: { id: p.id },
      data: {
        aadhaarVerified: p.aadhaarVerified,
        panVerified: p.panVerified,
        status: p.status,
        verifiedById: adminId,
        verifiedAt: new Date(),
        ...(notes && { notes }),
      },
    });

    logger.info('Service provider verified successfully', { providerId: p.id });
    return saved;
  }

  async suspendServiceProvider(providerId: string, adminId: string, reason?: string) {
    try {
      logger.info('Suspending service provider', { providerId, adminId });

      await this.findOrThrow(providerId);

      const notes = reason || 'Suspended by admin';
      if (notes.length > 500) {
        throw new ValidationError('ServiceProvider validation failed: notes: must not exceed 500 characters');
      }

      const serviceProvider = await this.prisma.serviceProvider.update({
        where: { id: providerId },
        data: { status: 'suspended', notes },
      });

      logger.info('Service provider suspended successfully', { providerId });
      return serviceProvider;
    } catch (error) {
      logger.error('Failed to suspend service provider', { error: error.message, providerId, adminId });
      throw error;
    }
  }

  async getAvailableProviders(bookingData: Record<string, any>) {
    try {
      logger.info('Finding available service providers', {
        services: bookingData.services,
        subservices: bookingData.subservices,
        date: bookingData.date,
        time: bookingData.time,
      });

      // fix: the weekday lookup used an invalid option ('lowercase') and threw, so this always 500'd.
      // Its result was unused (all filters were commented out), so it is dropped; all providers are returned.
      const serviceProviders = await this.prisma.serviceProvider.findMany({
        include: { services: SUMMARY, subservices: SUMMARY },
        orderBy: [{ ratingAverage: 'desc' }, { ratingTotal: 'desc' }],
      });

      logger.info('Available service providers found', {
        count: serviceProviders.length,
        totalFound: serviceProviders.length,
      });

      return serviceProviders;
    } catch (error) {
      logger.error('Failed to find available service providers', { error: error.message, bookingData });
      throw error;
    }
  }

  async assignToBooking(providerId: string, bookingId: string, adminId: string) {
    try {
      logger.info('Assigning service provider to booking', { providerId, bookingId, adminId });

      if (!isUuid(providerId)) throw new ValidationError('Invalid service provider id');
      if (!isUuid(bookingId)) throw new ValidationError('Invalid booking id');

      await this.findOrThrow(providerId);

      const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
      if (!booking) {
        throw new NotFoundError('Booking not found');
      }

      const updated = await this.prisma.booking.update({
        where: { id: bookingId },
        data: { serviceProviderId: providerId, assignedAt: new Date(), assignedById: adminId },
      });

      logger.info('Service provider assigned to booking successfully', { providerId, bookingId });

      return updated;
    } catch (error) {
      logger.error('Failed to assign service provider to booking', { error: error.message, providerId, bookingId, adminId });
      throw error;
    }
  }

  async getProviderStats(providerId: string) {
    try {
      logger.info('Getting service provider statistics', { providerId });

      const serviceProvider = await this.findOrThrow(providerId);

      const bookingStats = await this.prisma.booking.groupBy({
        by: ['status'],
        where: { serviceProviderId: providerId },
        _count: { _all: true },
      });

      const earnings = await this.prisma.booking.aggregate({
        where: { serviceProviderId: providerId, status: 'completed' },
        _sum: { finalPrice: true },
        _count: { _all: true },
      });

      const stats = {
        provider: serviceProvider,
        bookings: {
          total: bookingStats.reduce((sum, stat) => sum + stat._count._all, 0),
          byStatus: bookingStats.reduce((acc, stat) => {
            acc[stat.status] = stat._count._all;
            return acc;
          }, {} as Record<string, number>),
        },
        earnings: {
          totalEarnings: earnings._sum.finalPrice ?? 0,
          totalBookings: earnings._count._all,
        },
      };

      logger.info('Service provider statistics calculated successfully', { providerId });
      return stats;
    } catch (error) {
      logger.error('Failed to get service provider statistics', { error: error.message, providerId });
      throw error;
    }
  }

  async updateProviderRating(providerId: string, newRating: number) {
    try {
      logger.info('Updating service provider rating', { providerId, newRating });

      const serviceProvider = await this.findOrThrow(providerId);
      const updated = await this.prisma.serviceProvider.update({
        where: { id: providerId },
        data: applyRatingStats(serviceProvider, newRating),
      });

      logger.info('Service provider rating updated successfully', { providerId, newAverage: updated.ratingAverage });

      return updated;
    } catch (error) {
      logger.error('Failed to update service provider rating', { error: error.message, providerId, newRating });
      throw error;
    }
  }
}
