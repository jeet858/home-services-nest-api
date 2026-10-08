import { applyDecorators, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

// Equivalent of `verifyToken, isAdmin` on a route.
export const AdminOnly = () => applyDecorators(UseGuards(JwtAuthGuard, AdminGuard));
