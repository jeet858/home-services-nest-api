import type { Request, Response } from 'express';
import type { Logger } from 'winston';

// Port of createErrorHandler from src/utils/error.util.js; same log entry and response bodies.
export function handleError(err: any, req: Request, res: Response, logger: Logger) {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  logger.error('Application Error', {
    message: err.message,
    stack: err.stack,
    name: err.name,
    statusCode: err.statusCode,
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      user: req.user ? req.user.id : 'anonymous',
    },
  });

  if (err.name === 'ValidationError') {
    return res.status(400).json({ status: 'fail', message: err.message, errors: err.errors });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ status: 'fail', message: 'Invalid token' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ status: 'fail', message: 'Token expired' });
  }

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }

  if (process.env.NODE_ENV === 'development') {
    return res.status(500).json({ status: 'error', message: err.message, stack: err.stack });
  }

  return res.status(500).json({ status: 'error', message: 'Something went wrong!' });
}
