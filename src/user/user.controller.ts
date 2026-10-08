import { Controller, Get, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ValidationError } from '../common/errors/app-errors';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { logger } from '../common/logger/logger';
import { UserService } from './user.service';

// router.use(verifyToken) -> class-level guard.
@Controller('api/users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('profile')
  async getUser(@Req() req: Request, @Res() res: Response) {
    const userId = req.user.id;
    logger.info('Getting user profile', { userId });

    const user = await this.userService.getUser(userId);

    res.status(200).json({ status: 'success', data: { user } });
  }

  @Put('profile')
  async updateUser(@Req() req: Request, @Res() res: Response) {
    const userId = req.user.id;
    const updateData = req.body;

    logger.info('Updating user profile', { userId, fields: Object.keys(updateData) });

    if (!Object.keys(updateData).length) {
      throw new ValidationError('No update data provided');
    }

    const user = await this.userService.updateUser(userId, updateData);

    res.status(200).json({ status: 'success', data: { user } });
  }
}
