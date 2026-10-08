import { createClient, SupabaseClient } from '@supabase/supabase-js';
import multer from 'multer';
import appConfig from '../config/app.config';
import { ValidationError } from '../common/errors/app-errors';

let client: SupabaseClient | undefined;

// Lazy so the app still boots without Supabase env (createClient throws on a missing URL).
// Server-side client: the service role key bypasses RLS and there is no user session to persist.
export function supabase(): SupabaseClient {
  client ??= createClient(appConfig.supabase.url, appConfig.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const STORAGE_BUCKET = appConfig.supabase.bucket;

// Files are buffered in memory and pushed to Supabase by StorageService (limits/filter as before).
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 3,
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});
