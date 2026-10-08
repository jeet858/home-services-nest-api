import { Module } from '@nestjs/common';
import { SubserviceController } from './subservice.controller';
import { SubserviceService } from './subservice.service';

// Subservice catalogue (/api/subservice).
@Module({ controllers: [SubserviceController], providers: [SubserviceService] })
export class SubserviceModule {}
