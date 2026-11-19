import { Injectable } from '@nestjs/common';
import { logger } from '../common/logger/logger';
import { PrismaService } from '../prisma/prisma.service';
import { FcmSender } from './fcm.sender';

export type Recipient = { type: 'user' | 'provider'; id: string };

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  bookingId?: string | null;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationService {
  private readonly fcm = new FcmSender();

  constructor(private readonly prisma: PrismaService) {}

  /** Writes an inbox row and (when configured) a push. Never throws: a failed notice must not fail the action. */
  async notify(to: Recipient, input: NotifyInput) {
    try {
      await this.prisma.notification.create({
        data: {
          recipientType: to.type,
          recipientId: to.id,
          type: input.type,
          title: input.title,
          body: input.body,
          bookingId: input.bookingId ?? null,
          data: input.data ?? undefined,
        },
      });
      if (this.fcm.enabled && to.type === 'provider') {
        const p = await this.prisma.serviceProvider.findUnique({ where: { id: to.id }, select: { fcmToken: true } });
        void this.fcm.send(p?.fcmToken, input.title, input.body, { type: input.type, bookingId: input.bookingId ?? '' });
      }
    } catch (error) {
      logger.error('Failed to write notification', { error: (error as Error).message, type: input.type });
    }
  }

  async list(to: Recipient, page = 1, limit = 30) {
    const where = { recipientType: to.type, recipientId: to.id } as const;
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { notifications: items, unread };
  }

  unreadCount(to: Recipient) {
    return this.prisma.notification.count({ where: { recipientType: to.type, recipientId: to.id, readAt: null } });
  }

  /** Marks the given ids read, or everything when ids is empty. */
  async markRead(to: Recipient, ids?: unknown) {
    const list = Array.isArray(ids) ? ids.filter((i) => typeof i === 'string') : [];
    await this.prisma.notification.updateMany({
      where: { recipientType: to.type, recipientId: to.id, readAt: null, ...(list.length ? { id: { in: list } } : {}) },
      data: { readAt: new Date() },
    });
    return { unread: await this.unreadCount(to) };
  }
}
