import { Injectable } from '@nestjs/common';
import { DatabaseError, NotFoundError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { orNull } from '../common/utils/prisma-errors';
import { pickFields } from '../common/validation/model-input';
import { PrismaService } from '../prisma/prisma.service';

// fix: 'role' removed; clients could self-promote to admin and then log in via /api/admin/login.
const PROFILE_FIELDS = { name: 'string', email: 'string', avatar: 'string' } as const;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUser(userId: string) {
    try {
      logger.info('Fetching user profile', { userId });
      const user = await this.prisma.user.findUnique({ where: { id: userId }, omit: { password: true } });

      if (!user) {
        logger.warn('User not found', { userId });
        throw new NotFoundError('User not found');
      }

      logger.info('User profile fetched successfully', { userId });
      return user;
    } catch (error) {
      logger.error('Error fetching user profile', { error: error.message, userId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch user profile');
    }
  }

  async updateUser(userId: string, updateData: Record<string, any>) {
    try {
      logger.info('Updating user profile', { userId, fields: Object.keys(updateData) });

      const filteredData = pickFields(updateData, PROFILE_FIELDS);

      if (Object.keys(filteredData).length === 0) {
        logger.warn('No valid fields to update', { userId, updateData });
        throw new ValidationError('No valid fields to update');
      }

      const user = await orNull(
        this.prisma.user.update({ where: { id: userId }, data: filteredData, omit: { password: true } }),
      );

      if (!user) {
        logger.warn('User not found for update', { userId });
        throw new NotFoundError('User not found');
      }

      logger.info('User profile updated successfully', { userId });
      return user;
    } catch (error) {
      logger.error('Error updating user profile', {
        error: error.message,
        userId,
        updateData: Object.keys(updateData),
      });

      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to update user profile');
    }
  }
}
