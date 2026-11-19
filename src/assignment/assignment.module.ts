import { Module } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { CronController } from './cron.controller';

@Module({ controllers: [CronController], providers: [AssignmentService], exports: [AssignmentService] })
export class AssignmentModule {}
