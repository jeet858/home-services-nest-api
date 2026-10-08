import { ValidationError } from '../errors/app-errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): boolean => typeof value === 'string' && UUID_RE.test(value);

// fix: malformed ids used to surface as a Mongoose CastError (500); now a 400 before querying.
export function assertUuid(value: unknown, label: string): asserts value is string {
  if (!isUuid(value)) {
    throw new ValidationError(`Invalid ${label} id`);
  }
}
