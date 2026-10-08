import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticationError } from '../errors/app-errors';
import { logger } from '../logger/logger';

// Port of isAdmin middleware; must run after JwtAuthGuard. Keeps the original 401 (not 403).
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    try {
      if (!req.user) {
        throw new AuthenticationError('User not authenticated');
      }

      if (req.user.role !== 'admin') {
        logger.warn('Access denied: User is not an admin', { userId: req.user.id, role: req.user.role });
        throw new AuthenticationError('Access denied: Admin privileges required');
      }

      logger.info('Admin access granted', { userId: req.user.id });
      return true;
    } catch (error) {
      logger.error('Role check failed', { error: error.message, userId: req.user?.id });
      throw error;
    }
  }
}
