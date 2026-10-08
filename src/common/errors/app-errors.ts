// Verbatim port of src/utils/error.util.js error classes.
export class AppError extends Error {
  statusCode: number;
  status: string;
  isOperational = true;
  timestamp = new Date().toISOString();

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  errors: any[];
  constructor(message: string, errors: any[] = []) {
    super(message, 400);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string) {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string) {
    super(message, 500);
    this.name = 'DatabaseError';
  }
}

export class ExternalServiceError extends AppError {
  service: string;
  constructor(message: string, service: string) {
    super(message, 502);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

export class RateLimitError extends AppError {
  constructor(message: string) {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}
