import { Controller, Delete, Get, Post, Put, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors/app-errors';
import { AdminOnly } from '../common/guards/admin-only.decorator';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { StorageService } from '../storage/storage.service';
import { UploadFieldsInterceptor } from '../storage/upload-fields.interceptor';
import { aadhaarCardOf, bankDetailsOf, panCardOf, ratingOf } from './service-provider.domain';
import { ServiceProviderService } from './service-provider.service';

const DOCUMENT_FIELDS = [
  { name: 'aadhaarCardImage', maxCount: 1 },
  { name: 'panCardImage', maxCount: 1 },
  { name: 'passportPhoto', maxCount: 1 },
];

type Handled = Array<new (...args: any[]) => Error>;

// Controllers answered these error types themselves with { success:false, message }.
function sendKnownError(res: Response, error: any, handled: Handled) {
  const status = error instanceof ValidationError ? 400 : error instanceof NotFoundError ? 404 : error instanceof ConflictError ? 409 : 0;
  if (status && handled.some((type) => error instanceof type)) {
    res.status(status).json({ success: false, message: error.message });
    return true;
  }
  return false;
}

// Whole router is behind router.use(verifyToken, isAdmin).
@Controller('api/service-providers')
@AdminOnly()
export class ServiceProviderController {
  constructor(
    private readonly serviceProviderService: ServiceProviderService,
    private readonly storageService: StorageService,
  ) {}

  // Turns uploaded files into the aadhaarCard/panCard/passportPhoto fields (the form's card field holds the number).
  private async applyUploads(req: Request, data: Record<string, any>) {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    if (!files) return;

    if (files.aadhaarCardImage?.[0]) {
      const aadhaarResult = await this.storageService.uploadImage(files.aadhaarCardImage[0], 'aadhaarCard');
      data.aadhaarCard = { number: data.aadhaarCard, image: aadhaarResult.url, s3Key: aadhaarResult.key };
    }

    if (files.panCardImage?.[0]) {
      const panResult = await this.storageService.uploadImage(files.panCardImage[0], 'panCard');
      data.panCard = { number: data.panCard, image: panResult.url, s3Key: panResult.key };
    }

    if (files.passportPhoto?.[0]) {
      const passportResult = await this.storageService.uploadImage(files.passportPhoto[0], 'passportPhoto');
      data.passportPhoto = passportResult.url;
      data.passportPhotoS3Key = passportResult.key;
    }
  }

  @Post()
  @UseInterceptors(UploadFieldsInterceptor(DOCUMENT_FIELDS))
  async createServiceProvider(@Req() req: Request, @Res() res: Response) {
    try {
      const adminId = req.user.id;
      const providerData = { ...req.body };

      logger.info('Creating service provider request', { adminId, providerName: providerData.name });

      if (req.files) {
        try {
          await this.applyUploads(req, providerData);
          logger.info('Files processed successfully', {
            aadhaarCard: !!providerData.aadhaarCard?.image,
            panCard: !!providerData.panCard?.image,
            passportPhoto: !!providerData.passportPhoto,
          });
        } catch (uploadError) {
          logger.error('Failed to process uploaded files', { error: uploadError.message, adminId });
          return res.status(400).json({ success: false, message: `File upload failed: ${uploadError.message}` });
        }
      }

      const serviceProvider = await this.serviceProviderService.createServiceProvider(providerData, adminId);

      logger.info('Service provider created successfully', { providerId: serviceProvider.id });

      const aadhaar = aadhaarCardOf(serviceProvider);
      const pan = panCardOf(serviceProvider);
      res.status(201).json({
        success: true,
        message: 'Service provider created successfully',
        data: {
          serviceProvider: {
            id: serviceProvider.id,
            name: serviceProvider.name,
            email: serviceProvider.email,
            phoneNumber: serviceProvider.phoneNumber,
            status: serviceProvider.status,
            services: serviceProvider.services,
            subservices: serviceProvider.subservices,
            aadhaarCard: { number: aadhaar.number, verified: aadhaar.verified },
            panCard: { number: pan.number, verified: pan.verified },
            passportPhoto: serviceProvider.passportPhoto,
            address: serviceProvider.address,
            createdAt: serviceProvider.createdAt,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to create service provider', { error: error.message, adminId: req.user.id });
      if (!sendKnownError(res, error, [ValidationError, ConflictError])) throw error;
    }
  }

  @Get()
  async getAllServiceProviders(@Req() req: Request, @Res() res: Response) {
    const { page = 1, limit = 10, status, service, subservice, search, verificationStatus } = req.query as Record<string, any>;
    const filters = { status, service, subservice, search, verificationStatus };

    logger.info('Fetching all service providers request', { page, limit, filters, adminId: req.user.id });

    // fix: non-numeric page/limit produced NaN and a 500; fall back to the defaults.
    const result = await this.serviceProviderService.getAllServiceProviders(parseInt(page) || 1, parseInt(limit) || 10, filters);

    logger.info('Service providers fetched successfully', {
      count: result.serviceProviders.length,
      total: result.pagination.total,
    });

    res.status(200).json({
      success: true,
      message: 'Service providers fetched successfully',
      data: {
        serviceProviders: result.serviceProviders.map((provider) => {
          const aadhaar = aadhaarCardOf(provider);
          const pan = panCardOf(provider);
          return {
            id: provider.id,
            name: provider.name,
            email: provider.email,
            phoneNumber: provider.phoneNumber,
            address: provider.address,
            services: provider.services,
            subservices: provider.subservices,
            specializations: provider.specializations,
            experience: provider.experience,
            experienceUnit: provider.experienceUnit,
            qualification: provider.qualification,
            status: provider.status,
            rating: ratingOf(provider),
            availability: provider.availability,
            aadhaarCard: { number: aadhaar.number, verified: aadhaar.verified },
            panCard: { number: pan.number, verified: pan.verified },
            passportPhoto: provider.passportPhoto,
            createdBy: provider.createdBy,
            verifiedBy: provider.verifiedBy,
            verifiedAt: provider.verifiedAt,
            createdAt: provider.createdAt,
          };
        }),
        pagination: result.pagination,
      },
    });
  }

  @Get(':providerId')
  async getServiceProvider(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId } = req.params;
      logger.info('Fetching service provider request', { providerId, userId: req.user.id });
      assertUuid(providerId, 'service provider');

      const serviceProvider = await this.serviceProviderService.getServiceProvider(providerId);

      logger.info('Service provider fetched successfully', { providerId });

      res.status(200).json({
        success: true,
        message: 'Service provider fetched successfully',
        data: {
          serviceProvider: {
            id: serviceProvider.id,
            name: serviceProvider.name,
            email: serviceProvider.email,
            phoneNumber: serviceProvider.phoneNumber,
            address: serviceProvider.address,
            services: serviceProvider.services,
            subservices: serviceProvider.subservices,
            specializations: serviceProvider.specializations,
            experience: serviceProvider.experience,
            experienceUnit: serviceProvider.experienceUnit,
            qualification: serviceProvider.qualification,
            certifications: serviceProvider.certifications,
            status: serviceProvider.status,
            rating: ratingOf(serviceProvider),
            availability: serviceProvider.availability,
            aadhaarCard: aadhaarCardOf(serviceProvider),
            panCard: panCardOf(serviceProvider),
            passportPhoto: serviceProvider.passportPhoto,
            documents: serviceProvider.documents,
            bankDetails: bankDetailsOf(serviceProvider),
            commission: serviceProvider.commission,
            createdBy: serviceProvider.createdBy,
            verifiedBy: serviceProvider.verifiedBy,
            verifiedAt: serviceProvider.verifiedAt,
            notes: serviceProvider.notes,
            createdAt: serviceProvider.createdAt,
            updatedAt: serviceProvider.updatedAt,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to fetch service provider', { error: error.message, providerId: req.params.providerId });
      if (!sendKnownError(res, error, [NotFoundError])) throw error;
    }
  }

  @Put(':providerId')
  @UseInterceptors(UploadFieldsInterceptor(DOCUMENT_FIELDS))
  async updateServiceProvider(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId } = req.params;
      const adminId = req.user.id;
      const updateData = { ...req.body };

      logger.info('Updating service provider request', { providerId, adminId });
      assertUuid(providerId, 'service provider');

      if (req.files) {
        try {
          await this.applyUploads(req, updateData);
          logger.info('Update files processed successfully', {
            aadhaarCard: !!updateData.aadhaarCard?.image,
            panCard: !!updateData.panCard?.image,
            passportPhoto: !!updateData.passportPhoto,
          });
        } catch (uploadError) {
          logger.error('Failed to process update uploaded files', { error: uploadError.message, providerId, adminId });
          return res.status(400).json({ success: false, message: `File upload failed: ${uploadError.message}` });
        }
      }

      const updatedProvider = await this.serviceProviderService.updateServiceProvider(providerId, updateData, adminId);

      logger.info('Service provider updated successfully', { providerId });

      res.status(200).json({
        success: true,
        message: 'Service provider updated successfully',
        data: {
          serviceProvider: {
            id: updatedProvider.id,
            name: updatedProvider.name,
            email: updatedProvider.email,
            phoneNumber: updatedProvider.phoneNumber,
            address: updatedProvider.address,
            services: updatedProvider.services,
            subservices: updatedProvider.subservices,
            specializations: updatedProvider.specializations,
            experience: updatedProvider.experience,
            experienceUnit: updatedProvider.experienceUnit,
            qualification: updatedProvider.qualification,
            certifications: updatedProvider.certifications,
            status: updatedProvider.status,
            rating: ratingOf(updatedProvider),
            availability: updatedProvider.availability,
            aadhaarCard: aadhaarCardOf(updatedProvider),
            panCard: panCardOf(updatedProvider),
            passportPhoto: updatedProvider.passportPhoto,
            documents: updatedProvider.documents,
            bankDetails: bankDetailsOf(updatedProvider),
            commission: updatedProvider.commission,
            notes: updatedProvider.notes,
            updatedAt: updatedProvider.updatedAt,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to update service provider', {
        error: error.message,
        providerId: req.params.providerId,
        adminId: req.user.id,
      });
      if (!sendKnownError(res, error, [ValidationError, NotFoundError, ConflictError])) throw error;
    }
  }

  @Delete(':providerId')
  async deleteServiceProvider(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId } = req.params;
      const adminId = req.user.id;

      logger.info('Deleting service provider request', { providerId, adminId });
      assertUuid(providerId, 'service provider');

      const result = await this.serviceProviderService.deleteServiceProvider(providerId, adminId);

      logger.info('Service provider deleted successfully', { providerId });

      res.status(200).json({ success: true, message: result.message });
    } catch (error) {
      logger.error('Failed to delete service provider', {
        error: error.message,
        providerId: req.params.providerId,
        adminId: req.user.id,
      });
      if (!sendKnownError(res, error, [ValidationError, NotFoundError])) throw error;
    }
  }

  @Put(':providerId/verify')
  async verifyServiceProvider(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId } = req.params;
      const adminId = req.user.id;
      const { notes, verifyDocuments } = req.body;

      logger.info('Verifying service provider request', { providerId, adminId, verifyDocuments });
      assertUuid(providerId, 'service provider');

      const serviceProvider = await this.serviceProviderService.verifyServiceProvider(providerId, adminId, {
        notes,
        verifyDocuments,
      });

      logger.info('Service provider verified successfully', { providerId });

      res.status(200).json({
        success: true,
        message: 'Service provider verified successfully',
        data: {
          serviceProvider: {
            id: serviceProvider.id,
            name: serviceProvider.name,
            status: serviceProvider.status,
            aadhaarCard: { verified: serviceProvider.aadhaarVerified },
            panCard: { verified: serviceProvider.panVerified },
            verifiedBy: serviceProvider.verifiedById,
            verifiedAt: serviceProvider.verifiedAt,
            notes: serviceProvider.notes,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to verify service provider', {
        error: error.message,
        providerId: req.params.providerId,
        adminId: req.user.id,
      });
      if (!sendKnownError(res, error, [NotFoundError])) throw error;
    }
  }

  @Put(':providerId/suspend')
  async suspendServiceProvider(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId } = req.params;
      const adminId = req.user.id;
      const { reason } = req.body;

      logger.info('Suspending service provider request', { providerId, adminId, reason });
      assertUuid(providerId, 'service provider');

      const serviceProvider = await this.serviceProviderService.suspendServiceProvider(providerId, adminId, reason);

      logger.info('Service provider suspended successfully', { providerId });

      res.status(200).json({
        success: true,
        message: 'Service provider suspended successfully',
        data: {
          serviceProvider: {
            id: serviceProvider.id,
            name: serviceProvider.name,
            status: serviceProvider.status,
            notes: serviceProvider.notes,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to suspend service provider', {
        error: error.message,
        providerId: req.params.providerId,
        adminId: req.user.id,
      });
      if (!sendKnownError(res, error, [NotFoundError])) throw error;
    }
  }

  @Put(':providerId/verify-documents')
  async verifyDocuments(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId } = req.params;
      const adminId = req.user.id;
      const { documentType, verified, notes } = req.body;

      logger.info('Verifying service provider documents request', { providerId, adminId, documentType, verified });

      if (!providerId || !documentType) {
        return res.status(400).json({ success: false, message: 'Service provider ID and document type are required' });
      }
      assertUuid(providerId, 'service provider');

      const serviceProvider = await this.serviceProviderService.verifyDocuments(
        providerId,
        adminId,
        documentType,
        verified,
        notes,
      );

      logger.info('Service provider documents verified successfully', { providerId, documentType });

      res.status(200).json({
        success: true,
        message: 'Documents verified successfully',
        data: {
          serviceProvider: {
            id: serviceProvider.id,
            name: serviceProvider.name,
            aadhaarCard: { verified: serviceProvider.aadhaarVerified },
            panCard: { verified: serviceProvider.panVerified },
            status: serviceProvider.status,
            notes: serviceProvider.notes,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to verify service provider documents', {
        error: error.message,
        providerId: req.params.providerId,
        adminId: req.user.id,
      });
      if (!sendKnownError(res, error, [NotFoundError])) throw error;
    }
  }

  @Post('available')
  async getAvailableProviders(@Req() req: Request, @Res() res: Response) {
    const bookingData = req.body;

    logger.info('Finding available service providers request', { bookingData, adminId: req.user.id });

    const availableProviders = await this.serviceProviderService.getAvailableProviders(bookingData);

    logger.info('Available service providers found', { count: availableProviders.length });

    res.status(200).json({
      success: true,
      message: 'Available service providers fetched successfully',
      data: {
        serviceProviders: availableProviders.map((provider) => ({
          id: provider.id,
          name: provider.name,
          email: provider.email,
          phoneNumber: provider.phoneNumber,
          services: provider.services,
          subservices: provider.subservices,
          rating: ratingOf(provider),
          experience: provider.experience,
          experienceUnit: provider.experienceUnit,
          availability: provider.availability,
        })),
      },
    });
  }

  @Put(':providerId/assign/:bookingId')
  async assignToBooking(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId, bookingId } = req.params as Record<string, string>;
      const adminId = req.user.id;

      logger.info('Assigning service provider to booking request', { providerId, bookingId, adminId });

      const booking = await this.serviceProviderService.assignToBooking(providerId, bookingId, adminId);

      logger.info('Service provider assigned to booking successfully', { providerId, bookingId });

      res.status(200).json({
        success: true,
        message: 'Service provider assigned to booking successfully',
        data: {
          booking: {
            id: booking.id,
            serviceProviderId: booking.serviceProviderId,
            assignedAt: booking.assignedAt,
            assignedBy: booking.assignedById,
            status: booking.status,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to assign service provider to booking', {
        error: error.message,
        providerId: req.params.providerId,
        bookingId: req.params.bookingId,
        adminId: req.user.id,
      });
      if (!sendKnownError(res, error, [ValidationError, NotFoundError])) throw error;
    }
  }

  @Get(':providerId/stats')
  async getProviderStats(@Req() req: Request, @Res() res: Response) {
    try {
      const { providerId } = req.params;

      logger.info('Getting service provider statistics request', { providerId, adminId: req.user.id });
      assertUuid(providerId, 'service provider');

      const stats = await this.serviceProviderService.getProviderStats(providerId);

      logger.info('Service provider statistics fetched successfully', { providerId });

      res.status(200).json({
        success: true,
        message: 'Service provider statistics fetched successfully',
        data: {
          provider: {
            id: stats.provider.id,
            name: stats.provider.name,
            email: stats.provider.email,
            phoneNumber: stats.provider.phoneNumber,
            status: stats.provider.status,
            rating: ratingOf(stats.provider),
          },
          bookings: stats.bookings,
          earnings: stats.earnings,
        },
      });
    } catch (error) {
      logger.error('Failed to get service provider statistics', {
        error: error.message,
        providerId: req.params.providerId,
        adminId: req.user.id,
      });
      if (!sendKnownError(res, error, [NotFoundError])) throw error;
    }
  }
}
