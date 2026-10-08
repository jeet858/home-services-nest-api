import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import appConfig from '../config/app.config';
import {
  AuthenticationError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { orNull } from '../common/utils/prisma-errors';
import { pickFields, requireFields } from '../common/validation/model-input';
import { normalizePhoneNumber } from '../common/validation/user.rules';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_CREATE_FIELDS = { name: 'string', email: 'string', password: 'string', phoneNumber: 'string', avatar: 'string' } as const;
// 'isActive' is accepted (as before) but has no column, so it is ignored like Mongoose strict mode did.
const UPDATE_ALLOWED = ['name', 'email', 'isActive'];
const UPDATE_FIELDS = { name: 'string', email: 'string' } as const;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  private filterUpdate(updateData: Record<string, any>) {
    const allowed = Object.keys(updateData).filter((key) => UPDATE_ALLOWED.includes(key));
    if (allowed.length === 0) {
      throw new ValidationError('No valid fields to update');
    }
    return pickFields(updateData, UPDATE_FIELDS);
  }

  async login(email: string, password: string) {
    try {
      logger.info('Admin login attempt', { email });

      const admin = email ? await this.prisma.user.findFirst({ where: { email, role: 'admin' } }) : null;
      if (!admin) {
        throw new AuthenticationError('Invalid email or password');
      }

      // Plaintext comparison kept for compatibility with stored admin passwords (flagged in PORTING_NOTES).
      if (admin.password !== password) {
        throw new AuthenticationError('Invalid email or password');
      }

      // fix: omit password from the login response (it used to be returned).
      const updated = await this.prisma.user.update({
        where: { id: admin.id },
        data: { lastLogin: new Date() },
        omit: { password: true },
      });

      const token = jwt.sign({ id: admin.id, role: admin.role, email: admin.email }, appConfig.JWT_SECRET);

      logger.info('Admin logged in successfully', { adminId: admin.id });
      return { admin: updated, token };
    } catch (error) {
      logger.error('Admin login failed', { error: error.message, email });

      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new DatabaseError('Failed to login');
    }
  }

  async createAdmin(adminData: Record<string, any>, createdBy: string) {
    try {
      logger.info('Creating new admin', { createdBy });

      const requiredFields = ['name', 'email', 'password'];
      const missingFields = requiredFields.filter((field) => !adminData[field]);

      if (missingFields.length > 0) {
        throw new ValidationError(`Missing required fields: ${missingFields.join(', ')}`);
      }

      const existingAdmin = await this.prisma.user.findFirst({ where: { email: adminData.email } });
      if (existingAdmin) {
        throw new ValidationError('Email already exists');
      }

      const data = pickFields(adminData, ADMIN_CREATE_FIELDS);
      requireFields(data, ['phoneNumber'], 'User');
      data.phoneNumber = normalizePhoneNumber(data.phoneNumber);

      const admin = await this.prisma.user.create({
        data: { ...(data as any), role: 'admin' },
        omit: { password: true },
      });
      logger.info('Admin created successfully', { adminId: admin.id });
      return admin;
    } catch (error) {
      logger.error('Error creating admin', { error: error.message, createdBy });

      if (error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to create admin');
    }
  }

  async getAllAdmins(page = 1, limit = appConfig.pagination.defaultLimit) {
    try {
      logger.info('Fetching all admins', { page, limit });

      const skip = (page - 1) * limit;
      const admins = await this.prisma.user.findMany({
        where: { role: 'admin' },
        omit: { password: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.user.count({ where: { role: 'admin' } });

      logger.info('Admins fetched successfully', { count: admins.length, total, page, limit });

      return { admins, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Error fetching admins', { error: error.message, page, limit });
      throw new DatabaseError('Failed to fetch admins');
    }
  }

  async getAdmin(adminId: string) {
    try {
      logger.info('Fetching admin by ID', { adminId });

      const admin = await this.prisma.user.findFirst({ where: { id: adminId, role: 'admin' }, omit: { password: true } });

      if (!admin) {
        logger.warn('Admin not found', { adminId });
        throw new NotFoundError('Admin not found');
      }

      logger.info('Admin fetched successfully', { adminId });
      return admin;
    } catch (error) {
      logger.error('Error fetching admin', { error: error.message, adminId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch admin');
    }
  }

  async updateAdmin(adminId: string, updateData: Record<string, any>) {
    try {
      logger.info('Updating admin', { adminId });

      const filteredData = this.filterUpdate(updateData);

      const admin = await orNull(
        this.prisma.user.update({ where: { id: adminId, role: 'admin' }, data: filteredData, omit: { password: true } }),
      );

      if (!admin) {
        logger.warn('Admin not found for update', { adminId });
        throw new NotFoundError('Admin not found');
      }

      logger.info('Admin updated successfully', { adminId });
      return admin;
    } catch (error) {
      logger.error('Error updating admin', { error: error.message, adminId, updateData });

      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to update admin');
    }
  }

  async deleteAdmin(adminId: string, currentAdminId: string) {
    try {
      logger.info('Attempting to delete admin', { adminId, currentAdminId });

      if (adminId === currentAdminId) {
        logger.warn('Admin attempted to delete themselves', { adminId });
        throw new ValidationError('Cannot delete your own admin account');
      }

      const admin = await orNull(this.prisma.user.delete({ where: { id: adminId, role: 'admin' } }));

      if (!admin) {
        logger.warn('Admin not found for deletion', { adminId });
        throw new NotFoundError('Admin not found');
      }

      logger.info('Admin deleted successfully', { adminId });
      return admin;
    } catch (error) {
      logger.error('Error deleting admin', { error: error.message, adminId, currentAdminId });

      if (error instanceof NotFoundError || error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }

      throw new DatabaseError('Failed to delete admin');
    }
  }

  async getAllUsers(page = 1, limit = appConfig.pagination.defaultLimit) {
    try {
      logger.info('Fetching all users', { page, limit });

      const skip = (page - 1) * limit;
      const users = await this.prisma.user.findMany({
        where: { role: 'client' },
        omit: { password: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.user.count({ where: { role: 'client' } });

      logger.info('Users fetched successfully', { count: users.length, total, page, limit });

      return { users, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Error fetching users', { error: error.message, page, limit });
      throw new DatabaseError('Failed to fetch users');
    }
  }

  async getUser(userId: string) {
    try {
      logger.info('Fetching user by ID', { userId });

      const user = await this.prisma.user.findFirst({ where: { id: userId, role: 'client' }, omit: { password: true } });

      if (!user) {
        logger.warn('User not found', { userId });
        throw new NotFoundError('User not found');
      }

      logger.info('User fetched successfully', { userId });
      return user;
    } catch (error) {
      logger.error('Error fetching user', { error: error.message, userId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch user');
    }
  }

  async updateUser(userId: string, updateData: Record<string, any>) {
    try {
      logger.info('Updating user', { userId });

      const filteredData = this.filterUpdate(updateData);

      const user = await orNull(
        this.prisma.user.update({ where: { id: userId, role: 'client' }, data: filteredData, omit: { password: true } }),
      );

      if (!user) {
        logger.warn('User not found for update', { userId });
        throw new NotFoundError('User not found');
      }

      logger.info('User updated successfully', { userId });
      return user;
    } catch (error) {
      logger.error('Error updating user', { error: error.message, userId, updateData });

      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to update user');
    }
  }

  async deleteUser(userId: string) {
    try {
      logger.info('Deleting user', { userId });

      // Cascades to the user's addresses, bookings and ratings (Mongo left them orphaned).
      const user = await orNull(this.prisma.user.delete({ where: { id: userId, role: 'client' } }));

      if (!user) {
        logger.warn('User not found for deletion', { userId });
        throw new NotFoundError('User not found');
      }

      logger.info('User deleted successfully', { userId });
      return user;
    } catch (error) {
      logger.error('Error deleting user', { error: error.message, userId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to delete user');
    }
  }
}
