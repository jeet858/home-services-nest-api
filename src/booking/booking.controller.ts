import { Controller, Delete, Get, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../common/errors/app-errors';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { ServiceProviderService } from '../service-provider/service-provider.service';
import { BookingService } from './booking.service';

// router.use(verifyToken) -> class guard; routes after router.use(isAdmin) -> AdminGuard.
// Method order matters: my-bookings routes must register before GET :id.
@Controller('api/booking')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly serviceProviderService: ServiceProviderService,
  ) {}

  // ---- User routes ----

  @Get('my-bookings')
  async getUserBookings(@Req() req: Request, @Res() res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const userId = req.user.id;

    logger.info('Getting user bookings', { userId, page, limit });

    const result = await this.bookingService.getUserBookings(userId, page, limit);

    res.status(200).json({
      status: 'success',
      results: result.bookings.length,
      pagination: result.pagination,
      data: { bookings: result.bookings },
    });
  }

  @Get('my-bookings/:id')
  async getUserBooking(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const userId = req.user.id;
    logger.info('Getting user booking', { userId, bookingId: id });
    assertUuid(id, 'booking');

    const booking = await this.bookingService.getUserBooking(userId, id);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  @Post()
  async createBooking(@Req() req: Request, @Res() res: Response) {
    const bookingData = req.body;
    const userId = req.user.id;
    logger.info('Creating new booking', { userId });

    const booking = await this.bookingService.createBooking(bookingData, userId);

    res.status(201).json({ status: 'success', data: { booking } });
  }

  @Put('my-bookings/:id')
  async updateBooking(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const updateData = req.body;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    logger.info('Updating booking', { bookingId: id, userId, isAdmin });
    assertUuid(id, 'booking');

    const booking = await this.bookingService.updateBooking(id, updateData, userId, isAdmin);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  @Delete('my-bookings/:id')
  async deleteBooking(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    logger.info('Deleting booking', { bookingId: id, userId, isAdmin });
    assertUuid(id, 'booking');

    await this.bookingService.deleteBooking(id, userId, isAdmin);

    res.status(200).json({ status: 'success', data: null });
  }

  @Patch('my-bookings/:id/reschedule')
  async rescheduleBooking(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const { newDate, newTime } = req.body;
    const userId = req.user.id;
    logger.info('Rescheduling booking', { bookingId: id, userId });
    assertUuid(id, 'booking');

    const booking = await this.bookingService.rescheduleBooking(id, newDate, newTime, userId);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  @Patch('my-bookings/:id/cancel')
  async cancelBooking(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;
    logger.info('Cancelling booking', { bookingId: id, userId });
    assertUuid(id, 'booking');

    const booking = await this.bookingService.cancelBooking(id, userId, reason);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  @Post('my-bookings/:id/tip')
  async addTip(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const userId = req.user.id;
    logger.info('Adding tip to booking', { bookingId: id, userId });
    assertUuid(id, 'booking');

    const booking = await this.bookingService.addTip(id, req.body.amount, userId);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  // ---- Admin routes ----

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  async updateStatus(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    assertUuid(id, 'booking');

    const booking = await this.bookingService.updateStatus(id, req.body.status, req.body.reason);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  // Ops marks the job started once the pro enters the customer's service OTP.
  @Patch(':id/start')
  @UseGuards(AdminGuard)
  async markStarted(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    assertUuid(id, 'booking');

    const booking = await this.bookingService.markStarted(id, req.body.otp);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  @Get()
  @UseGuards(AdminGuard)
  async getAllBookings(@Req() req: Request, @Res() res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    const q = req.query as Record<string, string | undefined>;
    const filters = {
      status: q.status,
      paymentStatus: q.paymentStatus,
      from: q.from,
      to: q.to,
      unassigned: q.unassigned === 'true',
      userId: q.userId,
      providerId: q.providerId,
      search: q.search,
    };

    logger.info('Getting all bookings', { page, limit, filters });

    const result = await this.bookingService.getAllBookings(page, limit, filters);

    res.status(200).json({
      status: 'success',
      results: result.bookings.length,
      pagination: result.pagination,
      data: { bookings: result.bookings },
    });
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  async getBooking(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Getting booking by ID', { bookingId: id });
    assertUuid(id, 'booking');

    const booking = await this.bookingService.getBooking(id);

    res.status(200).json({ status: 'success', data: { booking } });
  }

  @Get('service/:serviceId')
  @UseGuards(AdminGuard)
  async getBookingsByService(@Req() req: Request, @Res() res: Response) {
    const { serviceId } = req.params;
    logger.info('Getting bookings by service', { serviceId });
    assertUuid(serviceId, 'service');

    const bookings = await this.bookingService.getBookingsByService(serviceId);

    res.status(200).json({ status: 'success', results: bookings.length, data: { bookings } });
  }

  @Get('subservice/:subserviceId')
  @UseGuards(AdminGuard)
  async getBookingsBySubservice(@Req() req: Request, @Res() res: Response) {
    const { subserviceId } = req.params;
    logger.info('Getting bookings by subservice', { subserviceId });
    assertUuid(subserviceId, 'subservice');

    const bookings = await this.bookingService.getBookingsBySubservice(subserviceId);

    res.status(200).json({ status: 'success', results: bookings.length, data: { bookings } });
  }

  @Put(':bookingId/assign-provider')
  @UseGuards(AdminGuard)
  async assignServiceProvider(@Req() req: Request, @Res() res: Response) {
    try {
      const { bookingId } = req.params as Record<string, string>;
      const { providerId } = req.body;
      const adminId = req.user.id;

      logger.info('Assigning service provider to booking', { bookingId, providerId, adminId });

      if (!providerId) {
        return res.status(400).json({ success: false, message: 'Service provider ID is required' });
      }

      const booking = await this.serviceProviderService.assignToBooking(providerId, bookingId, adminId);

      logger.info('Service provider assigned to booking successfully', { bookingId, providerId });

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
        bookingId: req.params.bookingId,
        adminId: req.user.id,
      });

      if (error instanceof ValidationError) {
        return res.status(400).json({ success: false, message: error.message });
      }

      if (error instanceof NotFoundError) {
        return res.status(404).json({ success: false, message: error.message });
      }

      throw error;
    }
  }
}
