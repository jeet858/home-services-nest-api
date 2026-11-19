import { applyDecorators, UseGuards } from '@nestjs/common';
import { ProviderGuard } from './provider.guard';

// Partner-app routes: a valid provider JWT sets req.provider.
export const ProviderOnly = () => applyDecorators(UseGuards(ProviderGuard));
