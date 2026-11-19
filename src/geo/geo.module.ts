import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

// Place search and reverse geocoding (/api/geo).
@Module({ controllers: [GeoController], providers: [GeoService] })
export class GeoModule {}
