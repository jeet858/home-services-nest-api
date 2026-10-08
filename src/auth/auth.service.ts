import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import appConfig from '../config/app.config';
import { DatabaseError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { generateOTP } from '../common/utils/generate-otp';
import { PrismaService } from '../prisma/prisma.service';

const JWT_SECRET = appConfig.JWT_SECRET;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAndSendOtp(userDetails: { phoneNumber?: string }) {
    try {
      logger.info('Starting OTP generation', { userDetails });

      const phoneNumber = userDetails?.phoneNumber;
      if (!phoneNumber) {
        throw new ValidationError('Phone number is required');
      }

      const cleanedPhoneNumber = String(phoneNumber).replace(/\D/g, '');
      if (cleanedPhoneNumber.length !== 10) {
        throw new ValidationError('Phone number must be 10 digits');
      }

      logger.info('Cleaned phone number', { cleanedPhoneNumber });

      const user = await this.prisma.user.findUnique({ where: { phoneNumber: cleanedPhoneNumber } });

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      const message = `One-Time Password for confirming your phone number is ${otp}. Please do not share this OTP with anyone - SR Enterprise. Visit our website - https://www.subidha.net.in`;

      const OtpParams = new URLSearchParams({
        username: appConfig.sms.username ?? '',
        password: appConfig.sms.password ?? '',
        unicode: 'false',
        from: appConfig.sms.from ?? '',
        to: `${cleanedPhoneNumber}`,
        text: message,
        dltContentId: appConfig.sms.dltContentId ?? '',
      });

      const apiUrl = `${appConfig.sms.apiUrl}?${OtpParams.toString()}`;

      // Replace any previous OTP for this number.
      await this.prisma.otp.deleteMany({ where: { phoneNumber: cleanedPhoneNumber } });
      await this.prisma.otp.create({ data: { phoneNumber: cleanedPhoneNumber, otp, expiresAt } });

      logger.info('OTP saved to database', { phoneNumber: cleanedPhoneNumber, expiresAt });
      logger.info('Sending OTP via SMS', { phoneNumber: cleanedPhoneNumber, otp });

      const response = await fetch(apiUrl, { method: 'POST' });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send OTP. API responded with status ${response.status}: ${errorText}`);
      }

      const responseData = await response.json();
      logger.info('OTP API response received', { responseData });

      // First OTP for a number registers the client.
      if (!user) {
        const newUser = await this.prisma.user.create({
          data: { phoneNumber: cleanedPhoneNumber, password: 'Not Required', role: 'client' },
        });

        logger.info('New user created', { phoneNumber: cleanedPhoneNumber, userId: newUser.id });
      }

      return { message: 'OTP sent successfully' };
    } catch (error) {
      logger.error('Error in generateAndSendOtp', { error: error.message, phoneNumber: userDetails?.phoneNumber });

      if (error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to send OTP');
    }
  }

  async verifyOtp(userDetails: { phoneNumber?: string; otp?: string }) {
    try {
      const { phoneNumber, otp } = userDetails;

      logger.info('Verifying OTP', { inputPhoneNumber: phoneNumber });

      if (!phoneNumber || !otp) {
        throw new ValidationError('Phone number and OTP are required');
      }

      const cleanedPhoneNumber = String(phoneNumber).replace(/\D/g, '');
      if (cleanedPhoneNumber.length !== 10) {
        throw new ValidationError('Phone number must be 10 digits');
      }

      const otpRecord = await this.prisma.otp.findFirst({ where: { phoneNumber: cleanedPhoneNumber, otp } });

      if (!otpRecord) {
        throw new ValidationError('Invalid OTP');
      }

      if (otpRecord.expiresAt < new Date()) {
        logger.warn('Expired OTP attempt', { phoneNumber: cleanedPhoneNumber, attemptedOtp: otp });

        await this.prisma.otp.deleteMany({ where: { phoneNumber: cleanedPhoneNumber } });
        throw new ValidationError('OTP has expired');
      }

      const user = await this.prisma.user.findUnique({ where: { phoneNumber: cleanedPhoneNumber } });

      if (!user) {
        throw new ValidationError('User not found');
      }

      // Same payload as before: no role and no expiry (flagged in PORTING_NOTES).
      const token = jwt.sign({ id: user.id, phoneNumber: user.phoneNumber }, JWT_SECRET);

      logger.info('OTP verified successfully', { phoneNumber: cleanedPhoneNumber, userId: user.id });

      await this.prisma.otp.deleteMany({ where: { phoneNumber: cleanedPhoneNumber } });

      return {
        message: 'OTP verified successfully',
        user: { id: user.id, name: user.name, phoneNumber: user.phoneNumber, email: user.email },
        token,
      };
    } catch (error) {
      logger.error('Failed to verify OTP', { error: error.message, phoneNumber: userDetails?.phoneNumber });

      if (error instanceof ValidationError) {
        throw error;
      }

      throw new DatabaseError('Failed to verify OTP');
    }
  }
}
