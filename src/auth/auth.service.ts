import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import appConfig from '../config/app.config';
import { AuthenticationError, DatabaseError, ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { generateOTP } from '../common/utils/generate-otp';
import { getOnboardingStep } from '../common/utils/onboarding';
import { PrismaService } from '../prisma/prisma.service';

const JWT_SECRET = appConfig.JWT_SECRET as string;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_TRIES = 5;

type Purpose = 'customer' | 'provider';

// Local testing only: OTP_DEV_ECHO=true returns the code in the response instead of needing SMS.
const devEcho = () => process.env.OTP_DEV_ECHO === 'true' && process.env.NODE_ENV !== 'production';

const cleanPhone = (phoneNumber: unknown) => {
  if (!phoneNumber) throw new ValidationError('Phone number is required');
  const cleaned = String(phoneNumber).replace(/\D/g, '').slice(-10);
  if (cleaned.length !== 10) throw new ValidationError('Phone number must be 10 digits');
  return cleaned;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private async sendSms(phone: string, otp: string) {
    const message = `One-Time Password for confirming your phone number is ${otp}. Please do not share this OTP with anyone - SR Enterprise. Visit our website - https://www.subidha.net.in`;
    const params = new URLSearchParams({
      username: appConfig.sms.username ?? '',
      password: appConfig.sms.password ?? '',
      unicode: 'false',
      from: appConfig.sms.from ?? '',
      to: phone,
      text: message,
      dltContentId: appConfig.sms.dltContentId ?? '',
    });
    const response = await fetch(`${appConfig.sms.apiUrl}?${params.toString()}`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`SMS gateway responded with status ${response.status}: ${await response.text()}`);
    }
  }

  /** Replaces any previous code for this number and purpose, then texts it. */
  private async issueOtp(phone: string, purpose: Purpose) {
    const otp = generateOTP();
    await this.prisma.otp.deleteMany({ where: { phoneNumber: phone, purpose } });
    await this.prisma.otp.create({ data: { phoneNumber: phone, otp, purpose, expiresAt: new Date(Date.now() + OTP_TTL_MS) } });

    if (devEcho()) {
      logger.warn('OTP_DEV_ECHO is on: SMS skipped', { phoneNumber: phone, purpose });
      return { devOtp: otp };
    }
    await this.sendSms(phone, otp);
    logger.info('OTP sent', { phoneNumber: phone, purpose });
    return {};
  }

  /** Checks a code, counting wrong tries; the code is burned after MAX_OTP_TRIES. */
  private async consumeOtp(phone: string, otp: unknown, purpose: Purpose) {
    if (!otp) throw new ValidationError('Phone number and OTP are required');
    const record = await this.prisma.otp.findFirst({ where: { phoneNumber: phone, purpose }, orderBy: { expiresAt: 'desc' } });
    if (!record) throw new ValidationError('Invalid OTP');

    if (record.expiresAt < new Date()) {
      await this.prisma.otp.deleteMany({ where: { phoneNumber: phone, purpose } });
      throw new ValidationError('OTP has expired');
    }
    if (record.otp !== String(otp)) {
      const attempts = record.attempts + 1;
      if (attempts >= MAX_OTP_TRIES) {
        await this.prisma.otp.deleteMany({ where: { phoneNumber: phone, purpose } });
        throw new ValidationError('Too many wrong attempts. Request a new OTP.');
      }
      await this.prisma.otp.update({ where: { id: record.id }, data: { attempts } });
      throw new ValidationError('Invalid OTP');
    }
    await this.prisma.otp.deleteMany({ where: { phoneNumber: phone, purpose } });
  }

  // ---- Customer app ----

  async generateAndSendOtp(userDetails: { phoneNumber?: string }) {
    const phone = cleanPhone(userDetails?.phoneNumber);
    try {
      const user = await this.prisma.user.findUnique({ where: { phoneNumber: phone } });
      const echo = await this.issueOtp(phone, 'customer');
      // The account itself is created on verify, so unverified numbers leave no user row.
      return { message: 'OTP sent successfully', isNewUser: !user, ...echo };
    } catch (error) {
      logger.error('Error in generateAndSendOtp', { error: error.message, phoneNumber: phone });
      throw new DatabaseError('Failed to send OTP');
    }
  }

  async verifyOtp(userDetails: { phoneNumber?: string; otp?: string }) {
    const phone = cleanPhone(userDetails?.phoneNumber);
    await this.consumeOtp(phone, userDetails?.otp, 'customer');
    try {
      let user = await this.prisma.user.findUnique({ where: { phoneNumber: phone } });
      const isNewUser = !user;

      // First verified OTP for a number registers the client.
      if (!user) {
        user = await this.prisma.user.upsert({
          where: { phoneNumber: phone },
          update: {},
          create: { phoneNumber: phone, password: 'Not Required', role: 'client' },
        });
        logger.info('New user created', { phoneNumber: phone, userId: user.id });
      }

      const onboardingStep = await getOnboardingStep(this.prisma, user.id);
      // Same payload as before (no role, no expiry) so existing installs keep working; see PORTING_NOTES.
      const token = jwt.sign({ id: user.id, phoneNumber: user.phoneNumber }, JWT_SECRET);

      return {
        message: 'OTP verified successfully',
        user: { id: user.id, name: user.name, phoneNumber: user.phoneNumber, email: user.email },
        token,
        isNewUser,
        onboardingStep,
      };
    } catch (error) {
      logger.error('Failed to verify OTP', { error: error.message, phoneNumber: phone });
      throw new DatabaseError('Failed to verify OTP');
    }
  }

  // ---- Partner app: only numbers an admin has registered as professionals can log in. ----

  async sendProviderOtp(phoneNumber: unknown) {
    const phone = cleanPhone(phoneNumber);
    const provider = await this.prisma.serviceProvider.findUnique({ where: { phoneNumber: phone }, select: { id: true } });
    if (!provider) {
      throw new ValidationError('This number is not registered as a Subidha partner. Contact Subidha support to join.');
    }
    try {
      const echo = await this.issueOtp(phone, 'provider');
      return { message: 'OTP sent successfully', ...echo };
    } catch (error) {
      logger.error('Error sending partner OTP', { error: error.message, phoneNumber: phone });
      throw new DatabaseError('Failed to send OTP');
    }
  }

  async verifyProviderOtp(phoneNumber: unknown, otp: unknown) {
    const phone = cleanPhone(phoneNumber);
    const provider = await this.prisma.serviceProvider.findUnique({
      where: { phoneNumber: phone },
      select: { id: true, name: true, phoneNumber: true, status: true, passportPhoto: true },
    });
    if (!provider) throw new AuthenticationError('This number is not registered as a Subidha partner');
    await this.consumeOtp(phone, otp, 'provider');

    const token = jwt.sign({ role: 'provider', providerId: provider.id, phoneNumber: provider.phoneNumber }, JWT_SECRET, {
      expiresIn: '30d',
    });
    await this.prisma.serviceProvider.update({ where: { id: provider.id }, data: { lastSeenAt: new Date() } });
    return { message: 'OTP verified successfully', token, provider };
  }
}
