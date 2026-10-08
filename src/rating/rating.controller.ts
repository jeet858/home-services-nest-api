import { Controller, Delete, Get, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../common/errors/app-errors';
import { AdminOnly } from '../common/guards/admin-only.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { RatingService } from './rating.service';

// Controllers answered these error types themselves with { success:false, message }.
function sendKnownError(res: Response, error: any, handleValidation = true) {
  if (handleValidation && error instanceof ValidationError) {
    res.status(400).json({ success: false, message: error.message });
    return true;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ success: false, message: error.message });
    return true;
  }
  return false;
}

// Guards are per route, exactly as in rating.route.js.
@Controller('api/ratings')
export class RatingController {
  constructor(private readonly ratingService: RatingService) {}

  @Post('booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  async createRating(@Req() req: Request, @Res() res: Response) {
    try {
      const { bookingId } = req.params;
      const userId = req.user.id;
      const { rating, feedback } = req.body;
      logger.info('Creating rating request', { bookingId, userId, rating });

      if (!rating || !feedback) {
        return res.status(400).json({ success: false, message: 'Rating and feedback are required' });
      }
      assertUuid(bookingId, 'booking');

      const ratings = await this.ratingService.createRating(bookingId, userId, { rating, feedback });

      logger.info('Rating created successfully', { bookingId, ratingCount: ratings.length });

      res.status(201).json({
        success: true,
        message: 'Rating submitted successfully',
        data: {
          bookingId,
          ratings: ratings.map((r) => ({
            id: r.id,
            rating: r.rating,
            feedback: r.feedback,
            status: r.status,
            subservice: r.subserviceId,
            createdAt: r.createdAt,
          })),
        },
      });
    } catch (error) {
      logger.error('Failed to create rating', { error: error.message, bookingId: req.params.bookingId, userId: req.user.id });
      if (!sendKnownError(res, error)) throw error;
    }
  }

  @Get('my-ratings')
  @UseGuards(JwtAuthGuard)
  async getUserRatings(@Req() req: Request, @Res() res: Response) {
    const userId = req.user.id;
    const { status } = req.query as Record<string, any>;

    logger.info('Fetching user ratings request', { userId, status });

    const ratings = await this.ratingService.getUserRatings(userId, status);

    logger.info('User ratings fetched successfully', { userId, count: ratings.length });

    res.status(200).json({
      success: true,
      message: 'Ratings fetched successfully',
      data: {
        ratings: ratings.map((r) => ({
          id: r.id,
          rating: r.rating,
          feedback: r.feedback,
          status: r.status,
          subservice: r.subservice,
          service: r.service,
          booking: r.booking,
          reviewedBy: r.reviewedById,
          reviewedAt: r.reviewedAt,
          reviewNote: r.reviewNote,
          createdAt: r.createdAt,
        })),
      },
    });
  }

  @Get('my-ratings/:ratingId')
  @UseGuards(JwtAuthGuard)
  async getRating(@Req() req: Request, @Res() res: Response) {
    try {
      const { ratingId } = req.params;
      const userId = req.user.id;

      logger.info('Fetching rating request', { ratingId, userId });
      assertUuid(ratingId, 'rating');

      const rating = await this.ratingService.getRating(ratingId);

      if (rating.userId !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied. You can only view your own ratings.' });
      }

      logger.info('Rating fetched successfully', { ratingId });

      res.status(200).json({
        success: true,
        message: 'Rating fetched successfully',
        data: {
          rating: {
            id: rating.id,
            rating: rating.rating,
            feedback: rating.feedback,
            status: rating.status,
            subservice: rating.subservice,
            service: rating.service,
            booking: rating.booking,
            user: rating.user,
            reviewedBy: rating.reviewedBy,
            reviewedAt: rating.reviewedAt,
            reviewNote: rating.reviewNote,
            createdAt: rating.createdAt,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to fetch rating', { error: error.message, ratingId: req.params.ratingId });
      // Original only special-cased NotFoundError here.
      if (!sendKnownError(res, error, false)) throw error;
    }
  }

  @Put('my-ratings/:ratingId')
  @UseGuards(JwtAuthGuard)
  async updateRating(@Req() req: Request, @Res() res: Response) {
    try {
      const { ratingId } = req.params;
      const userId = req.user.id;
      const { rating, feedback } = req.body;

      logger.info('Updating rating request', { ratingId, userId });

      if (!rating && !feedback) {
        return res.status(400).json({ success: false, message: 'At least one field (rating or feedback) is required' });
      }
      assertUuid(ratingId, 'rating');

      const updateData: Record<string, any> = {};
      if (rating !== undefined) updateData.rating = rating;
      if (feedback !== undefined) updateData.feedback = feedback;

      const updatedRating = await this.ratingService.updateRating(ratingId, userId, updateData);

      logger.info('Rating updated successfully', { ratingId });

      res.status(200).json({
        success: true,
        message: 'Rating updated successfully',
        data: {
          rating: {
            id: updatedRating.id,
            rating: updatedRating.rating,
            feedback: updatedRating.feedback,
            status: updatedRating.status,
            subservice: updatedRating.subservice,
            service: updatedRating.service,
            booking: updatedRating.booking,
            createdAt: updatedRating.createdAt,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to update rating', { error: error.message, ratingId: req.params.ratingId, userId: req.user.id });
      if (!sendKnownError(res, error)) throw error;
    }
  }

  @Delete('my-ratings/:ratingId')
  @UseGuards(JwtAuthGuard)
  async deleteRating(@Req() req: Request, @Res() res: Response) {
    try {
      const { ratingId } = req.params;
      const userId = req.user.id;

      logger.info('Deleting rating request', { ratingId, userId });
      assertUuid(ratingId, 'rating');

      const result = await this.ratingService.deleteRating(ratingId, userId);

      logger.info('Rating deleted successfully', { ratingId });

      res.status(200).json({ success: true, message: result.message });
    } catch (error) {
      logger.error('Failed to delete rating', { error: error.message, ratingId: req.params.ratingId, userId: req.user.id });
      if (!sendKnownError(res, error)) throw error;
    }
  }

  @Get('average/subservice/:subserviceId')
  async getAverageRatingForSubservice(@Req() req: Request, @Res() res: Response) {
    const { subserviceId } = req.params;

    logger.info('Fetching average rating for subservice request', { subserviceId });
    assertUuid(subserviceId, 'subservice');

    const stats = await this.ratingService.getAverageRatingForSubservice(subserviceId);

    logger.info('Average rating for subservice fetched successfully', { subserviceId });

    res.status(200).json({
      success: true,
      message: 'Average rating statistics fetched successfully',
      data: {
        subserviceId: stats.subserviceId,
        averageRating: stats.averageRating,
        totalRatings: stats.totalRatings,
        ratingDistribution: stats.ratingDistribution,
      },
    });
  }

  @Get('average/all-subservices')
  async getAverageRatingsForAllSubservices(@Res() res: Response) {
    logger.info('Fetching average ratings for all subservices request');

    const stats = await this.ratingService.getAverageRatingsForAllSubservices();

    logger.info('Average ratings for all subservices fetched successfully', { subserviceCount: stats.length });

    res.status(200).json({
      success: true,
      message: 'Average rating statistics fetched successfully',
      data: {
        subservices: stats.map((stat) => ({
          subserviceId: stat.subserviceId,
          subserviceName: stat.subserviceName,
          averageRating: stat.averageRating,
          totalRatings: stat.totalRatings,
          ratingDistribution: stat.ratingDistribution,
        })),
      },
    });
  }

  @Get('pending')
  @AdminOnly()
  async getPendingRatings(@Req() req: Request, @Res() res: Response) {
    const { page = 1, limit = 10 } = req.query as Record<string, any>;

    logger.info('Fetching pending ratings request', { page, limit, adminId: req.user.id });

    // fix: non-numeric page/limit produced NaN and a 500; fall back to the defaults.
    const result = await this.ratingService.getPendingRatings(parseInt(page) || 1, parseInt(limit) || 10);

    logger.info('Pending ratings fetched successfully', { count: result.ratings.length, total: result.pagination.total });

    res.status(200).json({
      success: true,
      message: 'Pending ratings fetched successfully',
      data: {
        ratings: result.ratings.map((r) => ({
          id: r.id,
          rating: r.rating,
          feedback: r.feedback,
          status: r.status,
          subservice: r.subservice,
          service: r.service,
          user: r.user,
          booking: r.booking,
          createdAt: r.createdAt,
        })),
        pagination: result.pagination,
      },
    });
  }

  @Get('all')
  @AdminOnly()
  async getAllRatings(@Req() req: Request, @Res() res: Response) {
    const { page = 1, limit = 10, status } = req.query as Record<string, any>;

    logger.info('Fetching all ratings request', { page, limit, status, adminId: req.user.id });

    const result = await this.ratingService.getAllRatings(parseInt(page) || 1, parseInt(limit) || 10, status);

    logger.info('All ratings fetched successfully', { count: result.ratings.length, total: result.pagination.total });

    res.status(200).json({
      success: true,
      message: 'All ratings fetched successfully',
      data: {
        ratings: result.ratings.map((r) => ({
          id: r.id,
          rating: r.rating,
          feedback: r.feedback,
          status: r.status,
          subservice: r.subservice,
          service: r.service,
          user: r.user,
          booking: r.booking,
          reviewedBy: r.reviewedBy,
          reviewedAt: r.reviewedAt,
          reviewNote: r.reviewNote,
          createdAt: r.createdAt,
        })),
        pagination: result.pagination,
      },
    });
  }

  @Put(':ratingId/review')
  @AdminOnly()
  async reviewRating(@Req() req: Request, @Res() res: Response) {
    try {
      const { ratingId } = req.params;
      const adminId = req.user.id;
      const { status, reviewNote } = req.body;

      logger.info('Reviewing rating request', { ratingId, adminId, status });

      if (!status) {
        return res.status(400).json({ success: false, message: 'Status is required' });
      }
      assertUuid(ratingId, 'rating');

      const reviewedRating = await this.ratingService.reviewRating(ratingId, adminId, { status, reviewNote });

      logger.info('Rating reviewed successfully', { ratingId, status });

      res.status(200).json({
        success: true,
        message: `Rating ${status} successfully`,
        data: {
          rating: {
            id: reviewedRating.id,
            rating: reviewedRating.rating,
            feedback: reviewedRating.feedback,
            status: reviewedRating.status,
            reviewedBy: reviewedRating.reviewedById,
            reviewedAt: reviewedRating.reviewedAt,
            reviewNote: reviewedRating.reviewNote,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to review rating', { error: error.message, ratingId: req.params.ratingId, adminId: req.user.id });
      if (!sendKnownError(res, error)) throw error;
    }
  }
}
