import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ServiceProviderController } from './service-provider.controller';
import { ServiceProviderService } from './service-provider.service';

// Provider management (/api/service-providers). Exported service is used by BookingModule.
@Module({
  imports: [StorageModule],
  controllers: [ServiceProviderController],
  providers: [ServiceProviderService],
  exports: [ServiceProviderService],
})
export class ServiceProviderModule {}
