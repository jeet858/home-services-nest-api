import { Injectable } from '@nestjs/common';
import appConfig from '../config/app.config';
import {
  AuthenticationError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { EmailService } from '../email/email.service';
import { isUuid } from '../common/utils/ids';
import { FieldSpec, pickFields, requireFields } from '../common/validation/model-input';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SUMMARY = { select: { id: true, name: true, description: true } };
const PRICED = { select: { id: true, name: true, description: true, originalPrice: true, discountedPrice: true } };
// populate('serviceProviderId', 'name email phoneNumber rating'); rating is flattened on the provider row.
const PROVIDER_SUMMARY = {
  select: {
    id: true,
    name: true,
    email: true,
    phoneNumber: true,
    ratingAverage: true,
    ratingTotal: true,
    ratingCount1: true,
    ratingCount2: true,
    ratingCount3: true,
    ratingCount4: true,
    ratingCount5: true,
  },
};
// Subservice `price` was selected but never existed, so only real fields are returned.
const FULL_INCLUDE = {
  services: SUMMARY,
  subservices: SUMMARY,
  address: true,
  serviceProvider: PROVIDER_SUMMARY,
  assignedBy: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;
const EDIT_INCLUDE = { services: SUMMARY, subservices: SUMMARY, address: true } satisfies Prisma.BookingInclude;

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const USER_FIELDS: FieldSpec = { addressId: 'string', date: 'date', time: 'string', discount: 'number', finalPrice: 'number' };
// fix: only admins may set provider assignment fields (users could previously $set any field).
const ADMIN_FIELDS: FieldSpec = { ...USER_FIELDS, status: 'string', serviceProviderId: 'string', assignedAt: 'date', assignedBy: 'string' };

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  // Same existence checks as before; non-UUID ids count as "not found" (Mongo cast errors became 500s).
  private async assertServiceIds(services: any) {
    if (!Array.isArray(services) || services.length === 0) {
      throw new ValidationError('At least one service must be provided');
    }
    const found = await this.prisma.service.count({ where: { id: { in: services.filter(isUuid) } } });
    if (found !== services.length) {
      throw new NotFoundError('One or more services not found');
    }
  }

  private async assertSubserviceIds(subservices: any) {
    if (!Array.isArray(subservices) || subservices.length === 0) {
      throw new ValidationError('At least one subservice must be provided');
    }
    const found = await this.prisma.subservice.count({ where: { id: { in: subservices.filter(isUuid) } } });
    if (found !== subservices.length) {
      throw new NotFoundError('One or more subservices not found');
    }
  }

  // Body fields -> Prisma data, with the enum/FK checks Mongoose validators or refs used to cover.
  private async toBookingData(input: Record<string, any>, isAdmin: boolean) {
    const data: Record<string, any> = pickFields(input, isAdmin ? ADMIN_FIELDS : USER_FIELDS);

    if (data.status !== undefined && !STATUSES.includes(data.status)) {
      throw new ValidationError(`Booking validation failed: status: \`${data.status}\` is not a valid enum value for path \`status\`.`);
    }
    if (data.assignedBy !== undefined) {
      data.assignedById = data.assignedBy;
      delete data.assignedBy;
    }
    for (const [field, label] of [['addressId', 'address'], ['serviceProviderId', 'service provider'], ['assignedById', 'user']]) {
      if (data[field] && !isUuid(data[field])) throw new ValidationError(`Invalid ${label} id`);
    }
    if (data.addressId && !(await this.prisma.address.findUnique({ where: { id: data.addressId }, select: { id: true } }))) {
      throw new NotFoundError('Address not found');
    }
    return data;
  }

  async getAllBookings(page = 1, limit = appConfig.pagination.defaultLimit) {
    try {
      logger.info('Admin: Fetching all bookings', { page, limit });

      const skip = (page - 1) * limit;
      const bookings = await this.prisma.booking.findMany({
        include: FULL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.booking.count();

      logger.info('Admin: Bookings fetched successfully', { count: bookings.length, total, page, limit });

      return { bookings, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Error fetching bookings', { error: error.message, page, limit });
      throw new DatabaseError('Failed to fetch bookings');
    }
  }

  async getBooking(bookingId: string) {
    try {
      logger.info('Admin: Fetching booking by ID', { bookingId });

      const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: FULL_INCLUDE });

      if (!booking) {
        logger.warn('Booking not found', { bookingId });
        throw new NotFoundError('Booking not found');
      }

      logger.info('Admin: Booking fetched successfully', { bookingId });
      return booking;
    } catch (error) {
      logger.error('Error fetching booking', { error: error.message, bookingId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch booking');
    }
  }

  async getUserBookings(userId: string, page = 1, limit = appConfig.pagination.defaultLimit) {
    try {
      logger.info('User: Fetching user bookings', { userId, page, limit });

      const skip = (page - 1) * limit;
      const rows = await this.prisma.booking.findMany({
        where: { userId },
        include: {
          ...FULL_INCLUDE,
          ratings: { select: { id: true, bookingId: true, rating: true, feedback: true }, orderBy: { createdAt: 'asc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      // Each booking carries its rating (or null), as the original attached from a lookup map.
      const bookings = rows.map(({ ratings, ...booking }) => ({ ...booking, rating: ratings[0] ?? null }));

      const total = await this.prisma.booking.count({ where: { userId } });

      logger.info('User: Bookings fetched successfully', { count: bookings.length, total, page, limit, userId });

      return { bookings, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Error fetching user bookings', { error: error.message, userId, page, limit });
      throw new DatabaseError('Failed to fetch user bookings');
    }
  }

  async getUserBooking(userId: string, bookingId: string) {
    try {
      logger.info('User: Fetching user booking', { userId, bookingId });

      const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, userId }, include: FULL_INCLUDE });

      if (!booking) {
        logger.warn('Booking not found or unauthorized', { userId, bookingId });
        throw new NotFoundError('Booking not found');
      }

      logger.info('User: Booking fetched successfully', { userId, bookingId });
      return booking;
    } catch (error) {
      logger.error('Error fetching user booking', { error: error.message, userId, bookingId });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to fetch booking');
    }
  }

  async createBooking(bookingData: Record<string, any>, userId: string) {
    try {
      logger.info('User: Creating new booking', { userId });

      await this.assertServiceIds(bookingData.services);
      await this.assertSubserviceIds(bookingData.subservices);

      const data = await this.toBookingData(bookingData, false);
      requireFields(data, ['date', 'time', 'finalPrice'], 'Booking');

      const booking = await this.prisma.booking.create({
        data: {
          ...(data as any),
          userId,
          status: 'pending',
          services: { connect: [...new Set<string>(bookingData.services)].map((id) => ({ id })) },
          subservices: { connect: [...new Set<string>(bookingData.subservices)].map((id) => ({ id })) },
        },
        include: { ...EDIT_INCLUDE, user: { select: { name: true, email: true, phoneNumber: true } } },
      });

      logger.info('User: Booking created successfully', { bookingId: booking.id, userId });

      // Fire-and-forget: notification email never blocks or fails the booking.
      void this.emailService.sendBookingCreated(booking);

      const { user, ...created } = booking;
      return created;
    } catch (error) {
      logger.error('Error creating booking', { error: error.message, userId });

      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError('Failed to create booking');
    }
  }

  async updateBooking(bookingId: string, updateData: Record<string, any>, userId: string, isAdmin = false) {
    try {
      logger.info('User: Updating booking', { bookingId, userId, isAdmin });

      const existingBooking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (!existingBooking) {
        throw new NotFoundError('Booking not found');
      }

      if (!isAdmin && existingBooking.userId !== userId) {
        throw new AuthenticationError('Not authorized to update this booking');
      }

      const data = await this.toBookingData(updateData, isAdmin);
      // $set accepted these arrays too; FKs now require the ids to exist.
      if (updateData.services !== undefined) await this.assertServiceIds(updateData.services);
      if (updateData.subservices !== undefined) await this.assertSubserviceIds(updateData.subservices);

      const booking = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          ...(data as any),
          ...(updateData.services && { services: { set: [...new Set<string>(updateData.services)].map((id) => ({ id })) } }),
          ...(updateData.subservices && {
            subservices: { set: [...new Set<string>(updateData.subservices)].map((id) => ({ id })) },
          }),
        },
        include: EDIT_INCLUDE,
      });

      if (updateData.status === 'completed' && existingBooking.status !== 'completed') {
        logger.info('Booking marked as completed - user can now provide rating', { bookingId });
      }

      logger.info('User: Booking updated successfully', { bookingId, userId });
      return booking;
    } catch (error) {
      logger.error('Error updating booking', { error: error.message, bookingId, userId });

      if (error instanceof NotFoundError || error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }

      throw new DatabaseError('Failed to update booking');
    }
  }

  async deleteBooking(bookingId: string, userId: string, isAdmin = false) {
    try {
      logger.info('User: Deleting booking', { bookingId, userId, isAdmin });

      const existingBooking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (!existingBooking) {
        throw new NotFoundError('Booking not found');
      }

      if (!isAdmin && existingBooking.userId !== userId) {
        throw new AuthenticationError('Not authorized to delete this booking');
      }

      // Cascades to the booking's ratings.
      const booking = await this.prisma.booking.delete({ where: { id: bookingId } });
      logger.info('User: Booking deleted successfully', { bookingId, userId });
      return booking;
    } catch (error) {
      logger.error('Error deleting booking', { error: error.message, bookingId, userId });

      if (error instanceof NotFoundError || error instanceof AuthenticationError) {
        throw error;
      }

      throw new DatabaseError('Failed to delete booking');
    }
  }

  async rescheduleBooking(bookingId: string, newDate: any, newTime: any, userId: string) {
    try {
      logger.info('User: Rescheduling booking', { bookingId, userId });

      const existingBooking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (!existingBooking) {
        throw new NotFoundError('Booking not found');
      }

      if (existingBooking.userId !== userId) {
        throw new AuthenticationError('Not authorized to reschedule this booking');
      }

      if (!newDate || !newTime) {
        throw new ValidationError('New date and time are required for rescheduling');
      }

      const newBookingDateTime = new Date(`${newDate}T${newTime}`);
      if (newBookingDateTime < new Date()) {
        throw new ValidationError('Cannot reschedule to a past date and time');
      }

      const data = pickFields({ date: newDate, time: newTime }, { date: 'date', time: 'string' });
      const booking = await this.prisma.booking.update({ where: { id: bookingId }, data, include: EDIT_INCLUDE });

      logger.info('User: Booking rescheduled successfully', { bookingId, userId });
      return booking;
    } catch (error) {
      logger.error('Error rescheduling booking', { error: error.message, bookingId, userId });

      if (error instanceof NotFoundError || error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }

      throw new DatabaseError('Failed to reschedule booking');
    }
  }

  async cancelBooking(bookingId: string, userId: string, reason?: any) {
    try {
      logger.info('User: Cancelling booking', { bookingId, userId });

      const existingBooking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (!existingBooking) {
        throw new NotFoundError('Booking not found');
      }

      if (existingBooking.userId !== userId) {
        throw new AuthenticationError('Not authorized to cancel this booking');
      }

      if (existingBooking.status === 'cancelled') {
        throw new ValidationError('Booking is already cancelled');
      }

      if (existingBooking.status === 'completed') {
        throw new ValidationError('Cannot cancel a completed booking');
      }

      const booking = await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: 'cancelled',
          cancellationReason: reason === undefined || reason === null ? null : String(reason),
          cancelledAt: new Date(),
        },
        include: EDIT_INCLUDE,
      });

      logger.info('User: Booking cancelled successfully', { bookingId, userId });
      return booking;
    } catch (error) {
      logger.error('Error cancelling booking', { error: error.message, bookingId, userId });

      if (error instanceof NotFoundError || error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }

      throw new DatabaseError('Failed to cancel booking');
    }
  }

  async getBookingsByService(serviceId: string) {
    try {
      logger.info('Admin: Fetching bookings by service', { serviceId });

      const bookings = await this.prisma.booking.findMany({
        where: { services: { some: { id: serviceId } } },
        include: { services: PRICED },
        orderBy: { createdAt: 'desc' },
      });

      logger.info('Admin: Bookings fetched successfully', { count: bookings.length, serviceId });

      return bookings;
    } catch (error) {
      logger.error('Error fetching bookings by service', { error: error.message, serviceId });
      throw new DatabaseError('Failed to fetch bookings');
    }
  }

  async getBookingsBySubservice(subserviceId: string) {
    try {
      logger.info('Admin: Fetching bookings by subservice', { subserviceId });

      const bookings = await this.prisma.booking.findMany({
        where: { subservices: { some: { id: subserviceId } } },
        include: { subservices: PRICED },
        orderBy: { createdAt: 'desc' },
      });

      logger.info('Admin: Bookings fetched successfully', { count: bookings.length, subserviceId });

      return bookings;
    } catch (error) {
      logger.error('Error fetching bookings by subservice', { error: error.message, subserviceId });
      throw new DatabaseError('Failed to fetch bookings');
    }
  }
}
