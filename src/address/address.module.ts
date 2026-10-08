import { Module } from '@nestjs/common';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';

// User addresses (/api/addresses).
@Module({ controllers: [AddressController], providers: [AddressService] })
export class AddressModule {}
