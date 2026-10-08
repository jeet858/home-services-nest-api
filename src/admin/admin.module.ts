import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// Admin login plus admin/client user management (/api/admin).
@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
