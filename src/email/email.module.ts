import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Resend email delivery; leaf module with no feature imports.
@Module({ providers: [EmailService], exports: [EmailService] })
export class EmailModule {}
