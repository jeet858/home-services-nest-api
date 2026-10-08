import { Injectable } from '@nestjs/common';
import { ValidationError } from '../common/errors/app-errors';
import { logger } from '../common/logger/logger';
import { STORAGE_BUCKET, supabase } from './storage.client';

// Supabase Storage replacement for S3UploadService; same method names and return shape.
@Injectable()
export class StorageService {
  async uploadImage(file: Express.Multer.File, fieldName: string) {
    try {
      if (!file) {
        throw new ValidationError('No file provided');
      }

      logger.info('Uploading image to storage', { fieldName, originalName: file.originalname, size: file.size });

      // Same key layout as the S3 version: <field>/<timestamp>-<random>.<ext>
      const fileExtension = file.originalname.split('.').pop();
      const key = `${file.fieldname}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`;

      const { error } = await supabase().storage
        .from(STORAGE_BUCKET)
        .upload(key, file.buffer, { contentType: file.mimetype, upsert: false });
      if (error) throw error;

      // Public bucket: the URL is permanent, so it is stored on the record like the S3 URL was.
      const { data } = supabase().storage.from(STORAGE_BUCKET).getPublicUrl(key);

      logger.info('Image uploaded successfully to storage', { fieldName, key, url: data.publicUrl });

      return {
        url: data.publicUrl,
        key,
        bucket: STORAGE_BUCKET,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      };
    } catch (error) {
      logger.error('Failed to upload image to storage', { error: error.message, fieldName, originalName: file?.originalname });
      throw error;
    }
  }

  async uploadMultipleImages(files: Express.Multer.File[], fieldNames: string[]) {
    try {
      logger.info('Uploading multiple images to storage', { count: files.length, fieldNames });

      const results = await Promise.all(files.map((file) => this.uploadImage(file, file.fieldname)));

      logger.info('Multiple images uploaded successfully', { count: results.length });
      return results;
    } catch (error) {
      logger.error('Failed to upload multiple images to storage', { error: error.message, count: files.length });
      throw error;
    }
  }

  async deleteImage(key: string) {
    try {
      logger.info('Deleting image from storage', { key });

      const { error } = await supabase().storage.from(STORAGE_BUCKET).remove([key]);
      if (error) throw error;

      logger.info('Image deleted successfully from storage', { key });
      return true;
    } catch (error) {
      logger.error('Failed to delete image from storage', { error: error.message, key });
      throw error;
    }
  }

  async getSignedUrl(key: string, expiresIn = 3600) {
    try {
      const { data, error } = await supabase().storage.from(STORAGE_BUCKET).createSignedUrl(key, expiresIn);
      if (error) throw error;
      return data.signedUrl;
    } catch (error) {
      logger.error('Failed to generate signed URL', { error: error.message, key });
      throw error;
    }
  }
}
