import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

// Public partner-app login. Errors flow through the global filter as { status, message }.
@Controller('api/partner/auth')
export class PartnerAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-otp')
  async sendOtp(@Body() body: { phoneNumber?: string }) {
    return { status: 'success', data: await this.authService.sendProviderOtp(body?.phoneNumber) };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: { phoneNumber?: string; otp?: string }) {
    return { status: 'success', data: await this.authService.verifyProviderOtp(body?.phoneNumber, body?.otp) };
  }
}
