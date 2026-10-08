import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Liveness probe (GET /health, outside /api).
@Module({ controllers: [HealthController] })
export class HealthModule {}
