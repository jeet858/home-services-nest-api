import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import appConfig from '../config/app.config';
import { PrismaClient } from '../generated/prisma/client';
import { logger } from '../common/logger/logger';

// Replaces src/database/mongodb.database.js.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: appConfig.database_url }) });
  }

  async onModuleInit() {
    // Like the original, a failed connect is logged but doesn't stop the app; queries retry on use.
    try {
      logger.info('Attempting to connect to PostgreSQL');
      await this.$connect();
      logger.info('✅ Database connected successfully');
    } catch (err) {
      logger.error('❌ Database connection failed:', { error: err.message, code: err.code, name: err.name });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
