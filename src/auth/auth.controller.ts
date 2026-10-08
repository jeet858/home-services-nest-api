import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { AuthService } from './auth.service';

// Public OTP login; errors are answered here with { message } bodies, as in the original.
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('user/send-otp')
  async generateAndSendOtp(@Req() req: Request, @Res() res: Response) {
    try {
      const phoneNumber = req.body.phoneNumber;
      logger.info('OTP generation request', { phoneNumber });

      if (!phoneNumber) {
        return res.status(400).json({ message: 'Phone number is required' });
      }

      const result = await this.authService.generateAndSendOtp({ phoneNumber: String(phoneNumber) });

      logger.info('OTP sent successfully', { phoneNumber });
      res.status(200).json(result);
    } catch (error) {
      logger.error('Register Controller Error:', { error: error.message, phoneNumber: req.body.phoneNumber });

      if (error instanceof ValidationError) {
        return res.status(400).json({ message: error.message });
      }

      if (error instanceof DatabaseError) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      res.status(500).json({ message: 'Internal server error' });
    }
  }

  @Post('user/verify-otp')
  async verifyOtp(@Req() req: Request, @Res() res: Response) {
    try {
      const { phoneNumber, otp } = req.body;
      logger.info('OTP verification request', { phoneNumber });

      if (!phoneNumber || !otp) {
        logger.warn('Missing required fields', { phoneNumber });
        return res.status(400).json({ message: 'Phone number and OTP are required' });
      }

      const result = await this.authService.verifyOtp({ phoneNumber: String(phoneNumber), otp: String(otp) });

      logger.info('OTP verified successfully', { phoneNumber });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('Verify OTP Controller Error:', { error: error.message, phoneNumber: req.body.phoneNumber });

      if (error instanceof ValidationError) {
        return res.status(400).json({ message: error.message });
      }

      if (error instanceof DatabaseError) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      return res.status(500).json({ message: error.message || 'OTP verification failed' });
    }
  }
}
