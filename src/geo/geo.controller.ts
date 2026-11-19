import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GeoService } from './geo.service';

// Location search for the address form (/api/geo). Signed-in customers only.
@Controller('api/geo')
@UseGuards(JwtAuthGuard)
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('search')
  async search(@Query('q') q?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    return { status: 'success', data: { places: await this.geo.search(q, lat, lng) } };
  }

  @Get('reverse')
  async reverse(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    return { status: 'success', data: { place: await this.geo.reverse(lat, lng) } };
  }
}
