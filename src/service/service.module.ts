import { Module } from '@nestjs/common';
import { ServiceController } from './service.controller';
import { ServiceService } from './service.service';

// Service catalogue (/api/services).
@Module({ controllers: [ServiceController], providers: [ServiceService] })
export class ServiceModule {}
