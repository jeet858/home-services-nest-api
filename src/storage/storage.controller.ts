import { Controller, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ValidationError } from '../common/errors/app-errors';
import { AdminOnly } from '../common/guards/admin-only.decorator';
import { logger } from '../common/logger/logger';
import { StorageService } from './storage.service';
import { UploadFieldsInterceptor } from './upload-fields.interceptor';

// Admin image uploads (service/subservice images); returns the public URL to store on the record.
@Controller('api/uploads')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('image')
  @AdminOnly()
  @UseInterceptors(UploadFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  async uploadImage(@Req() req: Request, @Res() res: Response) {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const file = files?.image?.[0];
    if (!file) {
      throw new ValidationError('No image provided');
    }

    logger.info('Uploading admin image');

    const { url, key } = await this.storageService.uploadImage(file, 'image');

    res.status(201).json({ status: 'success', data: { url, key } });
  }
}
