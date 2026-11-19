import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

// Global so every feature can notify without a module edge.
@Global()
@Module({ controllers: [NotificationController], providers: [NotificationService], exports: [NotificationService] })
export class NotificationModule {}
