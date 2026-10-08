import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

// Supabase Storage for provider documents; leaf module with no feature imports.
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
