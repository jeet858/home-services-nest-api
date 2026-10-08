import { ValidationError } from '../common/errors/app-errors';
import { isUuid } from '../common/utils/ids';
import { FieldSpec, pickFields } from '../common/validation/model-input';

// Pure helpers replacing the ServiceProvider schema's methods, hooks and validators.
// No DI, so both RatingService and ServiceProviderService can import them without a module edge.

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const STATUSES = ['active', 'inactive', 'suspended', 'pending', 'verification_pending'];
const EXPERIENCE_UNITS = ['months', 'years'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Schema default: every day available, no hours set. */
export const defaultAvailability = () => Object.fromEntries(DAYS.map((d) => [d, { available: true }]));

/** Pre-save hook: both documents verified moves verification_pending -> pending. */
export function updateVerificationStatus<T extends { aadhaarVerified: boolean; panVerified: boolean; status: string }>(p: T): T {
  if (p.aadhaarVerified && p.panVerified && p.status === 'verification_pending') {
    p.status = 'pending';
  }
  return p;
}

/** updateRatingStats: returns the column updates for one newly approved rating. */
export function applyRatingStats(p: any, newRating: number) {
  const counts = [1, 2, 3, 4, 5].map((i) => p[`ratingCount${i}`] + (i === newRating ? 1 : 0));
  const count = counts.reduce((a, b) => a + b, 0);
  const total = counts.reduce((sum, c, i) => sum + (i + 1) * c, 0);
  return {
    [`ratingCount${newRating}`]: counts[newRating - 1],
    ratingTotal: p.ratingTotal + 1,
    ratingAverage: count > 0 ? Math.round((total / count) * 100) / 100 : 0,
  };
}

/** isAvailable: day schedule exists, is available, and time falls in [start, end]. */
export function isAvailable(p: { availability: any }, day: string, time: string) {
  const daySchedule = p.availability?.[day.toLowerCase()];
  if (!daySchedule || !daySchedule.available) return false;
  const timeStr = time.toString();
  return timeStr >= daySchedule.start && timeStr <= daySchedule.end;
}

/** canHandleService. fix: compares id strings (ObjectId .includes() never matched). */
export function canHandleService(p: { services: { id: string }[]; subservices: { id: string }[] }, serviceId: string, subserviceId: string) {
  return p.services.some((s) => s.id === serviceId) && p.subservices.some((s) => s.id === subserviceId);
}

// ---- Response views: rebuild the Mongo sub-documents the controllers expose. ----

export const ratingOf = (p: any) => ({
  average: p.ratingAverage,
  totalRatings: p.ratingTotal,
  ratingDistribution: { '1': p.ratingCount1, '2': p.ratingCount2, '3': p.ratingCount3, '4': p.ratingCount4, '5': p.ratingCount5 },
});

export const aadhaarCardOf = (p: any) => ({ number: p.aadhaarNumber, image: p.aadhaarImage, verified: p.aadhaarVerified });

export const panCardOf = (p: any) => ({ number: p.panNumber, image: p.panImage, verified: p.panVerified });

export const bankDetailsOf = (p: any) => ({
  accountNumber: p.bankAccountNumber,
  ifscCode: p.bankIfscCode,
  accountHolderName: p.bankAccountHolderName,
  bankName: p.bankName,
});

// ---- Input mapping: request body (Mongo document shape) -> Prisma columns. ----

const SCALARS: FieldSpec = {
  name: 'string',
  email: 'string',
  phoneNumber: 'string',
  address: 'string',
  passportPhoto: 'string',
  passportPhotoS3Key: 'string',
  specializations: 'stringArray',
  experience: 'number',
  experienceUnit: 'string',
  qualification: 'string',
  availability: 'json',
  status: 'string',
  commission: 'number',
  notes: 'string',
};
// `s3Key` names kept for API/column compatibility; values are now Supabase object keys.
const CARD: FieldSpec = { number: 'string', image: 'string', s3Key: 'string', verified: 'boolean' };
const BANK: FieldSpec = { accountNumber: 'string', ifscCode: 'string', accountHolderName: 'string', bankName: 'string' };
const CERT: FieldSpec = { name: 'string', issuingAuthority: 'string', issueDate: 'date', expiryDate: 'date', certificateNumber: 'string' };
const DOC: FieldSpec = { type: 'string', name: 'string', url: 'string', uploadedAt: 'date', verified: 'boolean' };

const invalid = (path: string, message: string) =>
  new ValidationError(`ServiceProvider validation failed: ${path}: ${message}`);

// Multipart forms send nested objects/arrays as JSON strings.
function parseJson(v: any) {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new ValidationError(`Invalid JSON value: ${v}`);
  }
}

function mapCard(value: any, prefix: 'aadhaar' | 'pan', out: Record<string, any>) {
  if (value === undefined) return;
  // A bare string is the card number (the form field name doubles as the number).
  const card = pickFields(typeof value === 'object' && value !== null ? value : { number: value }, CARD);
  if (card.number !== undefined) out[`${prefix}Number`] = card.number;
  if (card.image !== undefined) out[`${prefix}Image`] = card.image;
  if (card.s3Key !== undefined) out[`${prefix}S3Key`] = card.s3Key;
  if (card.verified !== undefined) out[`${prefix}Verified`] = card.verified;
  // Replacing a card's number/image used to reset `verified` (whole sub-doc was $set); keep that.
  else if (card.number !== undefined || card.image !== undefined) out[`${prefix}Verified`] = false;
}

function mapIds(value: any, label: string): string[] {
  const ids = (Array.isArray(value) ? value : [value]).map(String);
  if (!ids.every(isUuid)) throw invalid(label, `Invalid ${label} id`);
  return ids;
}

/**
 * Maps a create/update body onto Prisma input. Relations are returned separately
 * because create uses `connect` while update uses `set`.
 */
export function toProviderInput(body: Record<string, any>) {
  const input = { ...body };
  for (const key of ['availability', 'aadhaarCard', 'panCard', 'bankDetails', 'certifications', 'documents', 'services', 'subservices', 'specializations']) {
    input[key] = parseJson(input[key]);
  }

  const data: Record<string, any> = pickFields(input, SCALARS);

  // Schema trim/lowercase options.
  if (typeof data.name === 'string') data.name = data.name.trim();
  if (typeof data.email === 'string') data.email = data.email.trim().toLowerCase();
  if (typeof data.qualification === 'string') data.qualification = data.qualification.trim();
  if (data.specializations) data.specializations = data.specializations.map((s: string) => s.trim());

  // Schema validators.
  if (data.email !== undefined && !EMAIL_RE.test(data.email)) throw invalid('email', `${data.email} is not a valid email!`);
  if (data.experience !== undefined && data.experience < 0) throw invalid('experience', 'must be at least 0');
  if (data.commission !== undefined && (data.commission < 0 || data.commission > 100)) throw invalid('commission', 'must be between 0 and 100');
  if (data.notes && data.notes.length > 500) throw invalid('notes', 'must not exceed 500 characters');
  if (data.status !== undefined && !STATUSES.includes(data.status)) throw invalid('status', `\`${data.status}\` is not a valid enum value`);
  if (data.experienceUnit !== undefined && !EXPERIENCE_UNITS.includes(data.experienceUnit)) {
    throw invalid('experienceUnit', `\`${data.experienceUnit}\` is not a valid enum value`);
  }

  mapCard(input.aadhaarCard, 'aadhaar', data);
  mapCard(input.panCard, 'pan', data);

  if (input.bankDetails && typeof input.bankDetails === 'object') {
    const bank = pickFields(input.bankDetails, BANK);
    if (bank.accountNumber !== undefined) data.bankAccountNumber = bank.accountNumber;
    if (bank.ifscCode !== undefined) data.bankIfscCode = bank.ifscCode;
    if (bank.accountHolderName !== undefined) data.bankAccountHolderName = bank.accountHolderName;
    if (bank.bankName !== undefined) data.bankName = bank.bankName;
  }

  const certifications =
    input.certifications === undefined
      ? undefined
      : (Array.isArray(input.certifications) ? input.certifications : [input.certifications]).map((c: any, i: number) => {
          const cert = pickFields(c, CERT);
          if (!cert.name) throw invalid(`certifications.${i}.name`, 'Path `name` is required.');
          if (!cert.issuingAuthority) throw invalid(`certifications.${i}.issuingAuthority`, 'Path `issuingAuthority` is required.');
          return cert;
        });

  const documents =
    input.documents === undefined
      ? undefined
      : (Array.isArray(input.documents) ? input.documents : [input.documents]).map((d: any, i: number) => {
          const doc = pickFields(d, DOC);
          for (const f of ['type', 'name', 'url']) {
            if (!doc[f]) throw invalid(`documents.${i}.${f}`, `Path \`${f}\` is required.`);
          }
          return doc;
        });

  return {
    data,
    serviceIds: input.services === undefined ? undefined : mapIds(input.services, 'service'),
    subserviceIds: input.subservices === undefined ? undefined : mapIds(input.subservices, 'subservice'),
    certifications,
    documents,
  };
}
