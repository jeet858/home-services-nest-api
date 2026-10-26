import { Injectable } from '@nestjs/common';
import appConfig from '../config/app.config';
import { DatabaseError, NotFoundError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { orNull } from '../common/utils/prisma-errors';
import { FieldSpec, pickFields, requireFields } from '../common/validation/model-input';
import { PrismaService } from '../prisma/prisma.service';

const ADDRESS_FIELDS: FieldSpec = {
  label: 'string', // Home / Office / Other, shown in the app's address pickers
  houseNo: 'string',
  street: 'string',
  fullAddress: 'string',
  landmark: 'string',
  city: 'string',
  state: 'string',
  zip: 'string',
  country: 'string',
  lat: 'number',
  lng: 'number',
};

// Coordinates (the user's map pin) are required on create; whenever sent they must be real WGS84 values.
function assertCoordinates(data: Record<string, any>) {
  if (data.lat != null && (data.lat < -90 || data.lat > 90)) {
    throw new ValidationError('Address validation failed: lat: must be between -90 and 90');
  }
  if (data.lng != null && (data.lng < -180 || data.lng > 180)) {
    throw new ValidationError('Address validation failed: lng: must be between -180 and 180');
  }
}

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  async createAddress(addressData: Record<string, any>, userId: string) {
    try {
      logger.info('Creating new address', { userId });

      const data = pickFields(addressData, ADDRESS_FIELDS);
      requireFields(data, ['street', 'city', 'state', 'zip', 'country', 'lat', 'lng'], 'Address');
      assertCoordinates(data);

      const address = await this.prisma.address.create({ data: { ...(data as any), userId } });
      logger.info('Address created successfully', { addressId: address.id, userId });
      return address;
    } catch (error) {
      logger.error('Error creating address', { error: error.message, userId });

      if (error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to create address');
    }
  }

  async getAllAddresses(userId: string, page = 1, limit = appConfig.pagination.defaultLimit) {
    try {
      logger.info('Fetching all addresses', { userId, page, limit });

      const skip = (page - 1) * limit;
      const addresses = await this.prisma.address.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.address.count({ where: { userId } });

      logger.info('Addresses fetched successfully', { count: addresses.length, total, page, limit, userId });

      return {
        addresses,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    } catch (error) {
      logger.error('Error fetching addresses', { error: error.message, userId, page, limit });
      throw new DatabaseError('Failed to fetch addresses');
    }
  }

  async getAddress(addressId: string, userId: string) {
    try {
      logger.info('Fetching address by ID', { addressId, userId });

      const address = await this.prisma.address.findFirst({ where: { id: addressId, userId } });

      if (!address) {
        logger.warn('Address not found', { addressId, userId });
        throw new NotFoundError('Address not found');
      }

      logger.info('Address fetched successfully', { addressId, userId });
      return address;
    } catch (error) {
      logger.error('Error fetching address', { error: error.message, addressId, userId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch address');
    }
  }

  async getAddressForAdmin(addressId: string) {
    try {
      logger.info('Fetching address by ID', { addressId });

      const address = await this.prisma.address.findUnique({ where: { id: addressId } });

      if (!address) {
        logger.warn('Address not found', { addressId });
        throw new NotFoundError('Address not found');
      }

      logger.info('Address fetched successfully', { addressId });
      return address;
    } catch (error) {
      logger.error('Error fetching address', { error: error.message, addressId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch address');
    }
  }

  async updateAddress(addressId: string, userId: string, updateData: Record<string, any>) {
    try {
      logger.info('Updating address', { addressId, userId });

      const data = pickFields(updateData, ADDRESS_FIELDS);
      assertCoordinates(data);

      const address = await orNull(this.prisma.address.update({ where: { id: addressId, userId }, data }));

      if (!address) {
        logger.warn('Address not found for update', { addressId, userId });
        throw new NotFoundError('Address not found');
      }

      logger.info('Address updated successfully', { addressId, userId });
      return address;
    } catch (error) {
      logger.error('Error updating address', { error: error.message, addressId, userId, updateData });

      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to update address');
    }
  }

  async deleteAddress(addressId: string, userId: string) {
    try {
      logger.info('Deleting address', { addressId, userId });

      const address = await orNull(this.prisma.address.delete({ where: { id: addressId, userId } }));

      if (!address) {
        logger.warn('Address not found for deletion', { addressId, userId });
        throw new NotFoundError('Address not found');
      }

      logger.info('Address deleted successfully', { addressId, userId });
      return address;
    } catch (error) {
      logger.error('Error deleting address', { error: error.message, addressId, userId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to delete address');
    }
  }
}
