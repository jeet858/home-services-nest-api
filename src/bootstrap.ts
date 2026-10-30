import 'reflect-metadata';
import './config/app.config'; // loads .env before anything reads process.env
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { logRequest, stream } from './common/logger/logger';

// Builds the app with the same middleware stack and order as src/app.js.
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Nest 11 runs on Express 5, whose default query parser is "simple"; keep Express 4's nested parsing.
  app.set('query parser', 'extended');

  // fix: behind Vercel's proxy every client shared the proxy IP, and so one rate-limit bucket.
  if (process.env.VERCEL) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  // Native mobile apps send no Origin; localhost (any port) is always allowed for local testing;
  // the admin panel and other web origins come from ALLOWED_ORIGINS.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const localhost = /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/;

  app.use(
    cors({
      origin:
        process.env.NODE_ENV === 'production'
          ? (origin, callback) => callback(null, !origin || localhost.test(origin) || allowedOrigins.includes(origin))
          : true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
      maxAge: 86400,
    }),
  );

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many requests from this IP, please try again later.',
    }),
  );

  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));
  // Express 5 leaves req.body undefined when nothing was parsed; Express 4 gave {}.
  app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  app.use(compression());

  app.use(logRequest);
  app.use(morgan('combined', { stream }));

  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  return app;
}
