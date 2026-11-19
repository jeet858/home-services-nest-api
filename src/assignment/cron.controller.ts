import { Controller, Get, Headers } from '@nestjs/common';
import { AuthenticationError } from '../common/errors/app-errors';
import { AssignmentService } from './assignment.service';

// Keeps matching moving when nobody is polling: an external scheduler calls this every minute
// with `Authorization: Bearer $CRON_SECRET` (see README, "Scheduler").
@Controller('api/cron')
export class CronController {
  constructor(private readonly assignments: AssignmentService) {}

  @Get('assignments')
  async sweep(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) throw new AuthenticationError('Unauthorized');
    const expired = await this.assignments.sweepExpired();
    const retried = await this.assignments.retrySearching();
    const escalated = await this.assignments.escalateStale();
    return { status: 'success', data: { expired, retried, escalated } };
  }
}
