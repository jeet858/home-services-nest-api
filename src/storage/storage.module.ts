import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

// Supabase Storage for provider documents and admin image uploads; leaf module with no feature imports.
@Module({ controllers: [StorageController], providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
