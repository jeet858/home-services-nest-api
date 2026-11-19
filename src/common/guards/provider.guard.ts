import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import appConfig from '../../config/app.config';
import { AuthenticationError } from '../errors/app-errors';
import { isUuid } from '../utils/ids';

// Partner-app tokens: { role: 'provider', providerId }. Customer tokens carry no providerId and fail here,
// and provider tokens carry no `id`, so they fail JwtAuthGuard on customer routes.
@Injectable()
export class ProviderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw new AuthenticationError('No token provided');

    try {
      const decoded = jwt.verify(header.split(' ')[1], appConfig.JWT_SECRET as string) as any;
      if (decoded?.role !== 'provider' || !isUuid(decoded?.providerId)) throw new jwt.JsonWebTokenError('Not a partner token');
      req.provider = { id: decoded.providerId, phoneNumber: decoded.phoneNumber };
      return true;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw new AuthenticationError('Token expired');
      throw new AuthenticationError('Invalid token');
    }
  }
}
