import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import appConfig from '../../config/app.config';
import { AuthenticationError } from '../errors/app-errors';
import { logger } from '../logger/logger';
import { isUuid } from '../utils/ids';

// Port of verifyToken middleware: verifies the Bearer JWT and sets req.user.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthenticationError('No token provided');
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, appConfig.JWT_SECRET) as any;

      // Pre-migration tokens carry Mongo ObjectIds, which no longer match any row.
      if (!isUuid(decoded?.id)) {
        throw new jwt.JsonWebTokenError('Unknown user id format');
      }

      req.user = decoded;
      logger.info('User authenticated', { userId: decoded.id });
      return true;
    } catch (error) {
      logger.error('Authentication failed', { error: error.message, path: req.path });

      // fix: TokenExpiredError extends JsonWebTokenError, so it must be checked first.
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid token');
      }
      throw error;
    }
  }
}
