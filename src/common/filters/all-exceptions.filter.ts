import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, NotFoundError } from '../errors/app-errors';
import { handleError } from '../errors/error-response';
import { logger } from '../logger/logger';

// Global replacement for the Express 404 + error-handler middleware.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    let err = exception;
    // App code only throws our NotFoundError, so Nest's NotFoundException means "no route matched".
    if (exception instanceof NotFoundException) {
      err = new NotFoundError(`Route ${req.originalUrl} not found`);
    } else if (exception instanceof HttpException) {
      // fix: framework errors (bad JSON, body > 10kb) were 500s; keep their 4xx status.
      err = new AppError(exception.message, exception.getStatus());
    } else if (exception?.expose && typeof exception.statusCode === 'number') {
      // body-parser's http-errors (e.g. 413) marked safe to show the client.
      err = new AppError(exception.message, exception.statusCode);
    }

    handleError(err, req, res, logger);
  }
}
