import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

// Signed-in user's own profile (/api/users).
@Module({ controllers: [UserController], providers: [UserService] })
export class UserModule {}
