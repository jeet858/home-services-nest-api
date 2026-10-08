import * as dotenv from 'dotenv';

// Loaded here too (as in the original) so any import order sees the env.
dotenv.config({ quiet: true });

const appConfig = {
  port: process.env.PORT,
  JWT_SECRET: process.env.JWT_SECRET,
  jwt_expiry: process.env.JWT_EXPIRY,
  brcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
  otp_expiry: process.env.OTP_EXPIRY,
  // Supabase Storage (public bucket) for provider document images.
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: process.env.SUPABASE_BUCKET || 'homeservice',
  },
  database_url: process.env.DATABASE_URL,
  // fix: services defaulted to appConfig.pagination.defaultLimit, which was undefined
  pagination: { defaultLimit: 10 },
  // Previously hardcoded in auth.service; fallbacks keep current behaviour until env is set.
  sms: {
    username: process.env.SMS_USERNAME || 'srenterotp.trans',
    password: process.env.SMS_PASSWORD || 'rm5d2',
    from: process.env.SMS_FROM || 'SREN',
    dltContentId: process.env.SMS_DLT_CONTENT_ID || '1707175247294315575',
  },
  // Resend transactional email; booking notifications go to the user plus bookingNotifyTo.
  email: {
    resendKey: process.env.RESEND_KEY,
    from: process.env.RESEND_FROM || 'onboarding@resend.dev',
    bookingNotifyTo: 'asyedsamser@gmail.com',
  },
};

export default appConfig;
