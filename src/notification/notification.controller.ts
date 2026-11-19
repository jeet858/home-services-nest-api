import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationService } from './notification.service';

// Customer inbox. The partner inbox lives under /api/partner/notifications.
@Controller('api/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(@Req() req: Request, @Query('page') page?: string) {
    const data = await this.notifications.list({ type: 'user', id: req.user!.id }, parseInt(page ?? '') || 1);
    return { status: 'success', data };
  }

  @Get('unread-count')
  async unread(@Req() req: Request) {
    return { status: 'success', data: { unread: await this.notifications.unreadCount({ type: 'user', id: req.user!.id }) } };
  }

  @Post('read')
  async read(@Req() req: Request, @Body() body: { ids?: string[] }) {
    return { status: 'success', data: await this.notifications.markRead({ type: 'user', id: req.user!.id }, body?.ids) };
  }
}
