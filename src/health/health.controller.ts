import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller('health')
export class HealthController {
  @Get()
  health(@Res() res: Response) {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  }
}
