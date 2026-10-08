import { ValidationError } from '../errors/app-errors';

// Was the User.phoneNumber setter + validator: strip non-digits, then require 10 digits.
export function normalizePhoneNumber(value: unknown): string {
  const cleaned = String(value).replace(/\D/g, '');
  if (cleaned.length !== 10) {
    throw new ValidationError(
      `User validation failed: phoneNumber: ${cleaned} is not a valid phone number!`,
    );
  }
  return cleaned;
}
