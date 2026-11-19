import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PartnerAuthController } from './partner-auth.controller';

// OTP login for the customer app (/api/auth) and the partner app (/api/partner/auth).
@Module({ controllers: [AuthController, PartnerAuthController], providers: [AuthService] })
export class AuthModule {}
