import { Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { PrismaService } from '../prisma/prisma.service';
import { applyRatingStats } from '../service-provider/service-provider.domain';

// Was the populate(...) chains on Rating queries.
const RATING_INCLUDE = {
  subservice: { select: { id: true, name: true, description: true } },
  service: { select: { id: true, name: true } },
  booking: { select: { id: true, date: true, time: true } },
};
const WITH_USER = {
  ...RATING_INCLUDE,
  user: { select: { id: true, name: true, phoneNumber: true } },
};
const WITH_REVIEWER = { ...WITH_USER, reviewedBy: { select: { id: true, name: true } } };

// Mongo just matched nothing for an unknown status; an invalid enum would make Prisma throw.
const statusFilter = (status?: string | null) =>
  !status ? {} : ['pending', 'approved', 'rejected'].includes(status) ? { status: status as any } : { id: { in: [] as string[] } };

const emptyDistribution = () => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });

// Schema min/max for `rating`. Stored as Int, so fractional values are rejected too.
function assertRatingValue(rating: any) {
  if (!Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
    throw new ValidationError('Rating must be between 1 and 5');
  }
}

@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  async createRating(bookingId: string, userId: string, ratingData: { rating: any; feedback: any }) {
    try {
      logger.info('Creating rating for booking', { bookingId, userId });

      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        include: { subservices: { select: { id: true, serviceId: true } } },
      });

      if (!booking) {
        throw new NotFoundError('Booking not found');
      }

      if (booking.userId !== userId) {
        throw new ValidationError('You can only rate your own bookings');
      }

      const existingRating = await this.prisma.rating.findFirst({ where: { bookingId }, select: { id: true } });
      if (existingRating) {
        throw new ValidationError('Rating already exists for this booking');
      }

      const { rating, feedback } = ratingData;

      if (rating < 1 || rating > 5) {
        throw new ValidationError('Rating must be between 1 and 5');
      }
      assertRatingValue(rating);

      if (!feedback || feedback.length < 10) {
        throw new ValidationError('Feedback must be at least 10 characters long');
      }

      if (feedback.length > 500) {
        throw new ValidationError('Feedback must not exceed 500 characters');
      }

      // Schema had serviceProvider required; unassigned bookings failed Mongoose validation (400).
      if (!booking.serviceProviderId) {
        throw new ValidationError('Rating validation failed: serviceProvider: Path `serviceProvider` is required.');
      }

      // One rating per subservice, all-or-nothing. fix: was non-atomic and hit unique(booking) after the first.
      const ratings = await this.prisma.$transaction(
        booking.subservices.map((subservice) =>
          this.prisma.rating.create({
            data: {
              bookingId,
              userId,
              serviceProviderId: booking.serviceProviderId,
              subserviceId: subservice.id,
              serviceId: subservice.serviceId,
              rating: Number(rating),
              feedback: String(feedback),
              status: 'pending',
            },
          }),
        ),
      );

      logger.info('Rating created successfully', { bookingId, count: ratings.length, rating, feedbackLength: feedback.length });

      return ratings;
    } catch (error) {
      logger.error('Failed to create rating for booking', { error: error.message, bookingId, userId });
      throw error;
    }
  }

  async getUserRatings(userId: string, status: string | null = null) {
    try {
      logger.info('Fetching user ratings', { userId, status });

      const ratings = await this.prisma.rating.findMany({
        where: { userId, ...statusFilter(status) },
        include: RATING_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });

      logger.info('User ratings fetched successfully', { userId, count: ratings.length });

      return ratings;
    } catch (error) {
      logger.error('Failed to fetch user ratings', { error: error.message, userId });
      throw error;
    }
  }

  async getRating(ratingId: string) {
    try {
      logger.info('Fetching rating', { ratingId });

      const rating = await this.prisma.rating.findUnique({ where: { id: ratingId }, include: WITH_REVIEWER });

      if (!rating) {
        throw new NotFoundError('Rating not found');
      }

      logger.info('Rating fetched successfully', { ratingId });
      return rating;
    } catch (error) {
      logger.error('Failed to fetch rating', { error: error.message, ratingId });
      throw error;
    }
  }

  async updateRating(ratingId: string, userId: string, updateData: { rating?: any; feedback?: any }) {
    try {
      logger.info('Updating rating', { ratingId, userId });

      const rating = await this.prisma.rating.findUnique({ where: { id: ratingId } });
      if (!rating) {
        throw new NotFoundError('Rating not found');
      }

      if (rating.userId !== userId) {
        throw new ValidationError('You can only update your own ratings');
      }

      if (rating.status !== 'pending') {
        throw new ValidationError('Cannot update approved or rejected ratings');
      }

      const { rating: newRating, feedback } = updateData;

      if (newRating && (newRating < 1 || newRating > 5)) {
        throw new ValidationError('Rating must be between 1 and 5');
      }
      if (newRating !== undefined) assertRatingValue(newRating);

      if (feedback) {
        if (feedback.length < 10) {
          throw new ValidationError('Feedback must be at least 10 characters long');
        }
        if (feedback.length > 500) {
          throw new ValidationError('Feedback must not exceed 500 characters');
        }
      }

      // Only rating/feedback are writable (the controller already builds updateData from those two).
      const updatedRating = await this.prisma.rating.update({
        where: { id: ratingId },
        data: {
          ...(newRating !== undefined && { rating: Number(newRating) }),
          ...(feedback !== undefined && { feedback: String(feedback) }),
        },
        include: RATING_INCLUDE,
      });

      logger.info('Rating updated successfully', { ratingId });
      return updatedRating;
    } catch (error) {
      logger.error('Failed to update rating', { error: error.message, ratingId, userId });
      throw error;
    }
  }

  async deleteRating(ratingId: string, userId: string) {
    try {
      logger.info('Deleting rating', { ratingId, userId });

      const rating = await this.prisma.rating.findUnique({ where: { id: ratingId } });
      if (!rating) {
        throw new NotFoundError('Rating not found');
      }

      if (rating.userId !== userId) {
        throw new ValidationError('You can only delete your own ratings');
      }

      if (rating.status !== 'pending') {
        throw new ValidationError('Cannot delete approved or rejected ratings');
      }

      await this.prisma.rating.delete({ where: { id: ratingId } });

      logger.info('Rating deleted successfully', { ratingId });
      return { message: 'Rating deleted successfully' };
    } catch (error) {
      logger.error('Failed to delete rating', { error: error.message, ratingId, userId });
      throw error;
    }
  }

  async reviewRating(ratingId: string, adminId: string, reviewData: { status: any; reviewNote?: any }) {
    try {
      logger.info('Reviewing rating', { ratingId, adminId });

      const rating = await this.prisma.rating.findUnique({ where: { id: ratingId } });
      if (!rating) {
        throw new NotFoundError('Rating not found');
      }

      const { status, reviewNote } = reviewData;

      if (!['approved', 'rejected'].includes(status)) {
        throw new ValidationError('Status must be either approved or rejected');
      }

      if (reviewNote && reviewNote.length > 200) {
        throw new ValidationError('Review note must not exceed 200 characters');
      }

      // Review + provider stats in one transaction. fix: previously two independent saves.
      const reviewed = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.rating.update({
          where: { id: ratingId },
          data: {
            status,
            reviewedById: adminId,
            reviewedAt: new Date(),
            ...(reviewNote && { reviewNote: String(reviewNote) }),
          },
        });

        if (status === 'approved' && saved.serviceProviderId) {
          const serviceProvider = await tx.serviceProvider.findUnique({ where: { id: saved.serviceProviderId } });
          if (serviceProvider) {
            await tx.serviceProvider.update({
              where: { id: serviceProvider.id },
              data: applyRatingStats(serviceProvider, saved.rating),
            });
            logger.info('Service provider rating updated', { providerId: saved.serviceProviderId, newRating: saved.rating });
          }
        }

        return saved;
      });

      logger.info('Rating reviewed successfully', { ratingId, status });
      return reviewed;
    } catch (error) {
      logger.error('Failed to review rating', { error: error.message, ratingId, adminId });
      throw error;
    }
  }

  // Was a $match/$group aggregate; a groupBy on the rating value yields both the average and distribution.
  async getAverageRatingForSubservice(subserviceId: string) {
    try {
      logger.info('Calculating average rating for subservice', { subserviceId });

      const groups = await this.prisma.rating.groupBy({
        by: ['rating'],
        where: { subserviceId, status: 'approved' },
        _count: { _all: true },
      });

      const distribution = emptyDistribution();
      let totalRatings = 0;
      let sum = 0;
      for (const g of groups) {
        distribution[String(g.rating)] = g._count._all;
        totalRatings += g._count._all;
        sum += g.rating * g._count._all;
      }

      if (totalRatings === 0) {
        return { subserviceId, averageRating: 0, totalRatings: 0, ratingDistribution: distribution };
      }

      const finalStats = {
        subserviceId,
        averageRating: Math.round((sum / totalRatings) * 100) / 100,
        totalRatings,
        ratingDistribution: distribution,
      };

      logger.info('Average rating calculated successfully', {
        subserviceId,
        averageRating: finalStats.averageRating,
        totalRatings: finalStats.totalRatings,
      });

      return finalStats;
    } catch (error) {
      logger.error('Failed to calculate average rating for subservice', { error: error.message, subserviceId });
      throw error;
    }
  }

  async getAverageRatingsForAllSubservices() {
    try {
      logger.info('Calculating average ratings for all subservices');

      const groups = await this.prisma.rating.groupBy({
        by: ['subserviceId', 'rating'],
        where: { status: 'approved' },
        _count: { _all: true },
      });

      const bySubservice = new Map<string, { sum: number; total: number; distribution: Record<string, number> }>();
      for (const g of groups) {
        const entry = bySubservice.get(g.subserviceId) ?? { sum: 0, total: 0, distribution: emptyDistribution() };
        entry.distribution[String(g.rating)] = g._count._all;
        entry.total += g._count._all;
        entry.sum += g.rating * g._count._all;
        bySubservice.set(g.subserviceId, entry);
      }

      // Was the $lookup + $unwind on subservices.
      const subservices = await this.prisma.subservice.findMany({
        where: { id: { in: [...bySubservice.keys()] } },
        select: { id: true, name: true },
      });

      const finalResult = subservices
        .map((s) => {
          const entry = bySubservice.get(s.id);
          return {
            subserviceId: s.id,
            subserviceName: s.name,
            averageRating: Math.round((entry.sum / entry.total) * 100) / 100,
            totalRatings: entry.total,
            ratingDistribution: entry.distribution,
          };
        })
        .sort((a, b) => b.averageRating - a.averageRating);

      logger.info('Average ratings calculated successfully', { subserviceCount: finalResult.length });

      return finalResult;
    } catch (error) {
      logger.error('Failed to calculate average ratings for all subservices', { error: error.message });
      throw error;
    }
  }

  async getPendingRatings(page = 1, limit = 10) {
    try {
      logger.info('Fetching pending ratings', { page, limit });

      const skip = (page - 1) * limit;
      const ratings = await this.prisma.rating.findMany({
        where: { status: 'pending' },
        include: WITH_USER,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.rating.count({ where: { status: 'pending' } });

      logger.info('Pending ratings fetched successfully', { count: ratings.length, total, page, limit });

      return { ratings, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Failed to fetch pending ratings', { error: error.message, page, limit });
      throw error;
    }
  }

  async getAllRatings(page = 1, limit = 10, status: string | null = null) {
    try {
      logger.info('Fetching all ratings', { page, limit, status });

      const where = statusFilter(status);

      const skip = (page - 1) * limit;
      const ratings = await this.prisma.rating.findMany({
        where,
        include: WITH_REVIEWER,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const total = await this.prisma.rating.count({ where });

      logger.info('All ratings fetched successfully', { count: ratings.length, total, page, limit });

      return { ratings, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    } catch (error) {
      logger.error('Failed to fetch all ratings', { error: error.message, page, limit });
      throw error;
    }
  }
}
