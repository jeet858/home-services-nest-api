import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { JobModule } from '../job/job.module';
import { StorageModule } from '../storage/storage.module';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

// Partner app API (/api/partner). Login lives in AuthModule (/api/partner/auth).
@Module({
  imports: [AssignmentModule, JobModule, StorageModule],
  controllers: [PartnerController],
  providers: [PartnerService],
})
export class PartnerModule {}
