import { Module } from '@nestjs/common';
import { RatingController } from './rating.controller';
import { RatingService } from './rating.service';

// Booking ratings and moderation (/api/ratings). Provider stats go through Prisma, not ServiceProviderModule.
@Module({ controllers: [RatingController], providers: [RatingService] })
export class RatingModule {}
