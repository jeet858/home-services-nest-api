import { ValidationError } from '../errors/app-errors';

// Stands in for Mongoose casting + strict mode: unknown keys are dropped, known ones cast to the column type.
export type FieldType = 'string' | 'number' | 'int' | 'boolean' | 'date' | 'stringArray' | 'json';
export type FieldSpec = Record<string, FieldType>;

const castError = (path: string, type: string, value: unknown) =>
  new ValidationError(`Cast to ${type} failed for value "${String(value)}" at path "${path}"`);

function castValue(path: string, type: FieldType, value: any) {
  if (value === null) return null;

  switch (type) {
    case 'string':
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      throw castError(path, 'string', value);
    case 'number':
    case 'int': {
      const n = typeof value === 'number' ? value : value === '' ? NaN : Number(value);
      if (Number.isNaN(n) || (type === 'int' && !Number.isInteger(n))) throw castError(path, 'Number', value);
      return n;
    }
    case 'boolean':
      if (value === true || value === 'true' || value === 1 || value === '1' || value === 'yes') return true;
      if (value === false || value === 'false' || value === 0 || value === '0' || value === 'no') return false;
      throw castError(path, 'Boolean', value);
    case 'date': {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) throw castError(path, 'date', value);
      return d;
    }
    case 'stringArray':
      // Mongoose wraps a single value into an array (common with multipart forms).
      return (Array.isArray(value) ? value : [value]).map((v, i) => castValue(`${path}.${i}`, 'string', v));
    case 'json':
      return value;
  }
}

export function pickFields(input: Record<string, any> | undefined, spec: FieldSpec): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object') return out;

  for (const [key, type] of Object.entries(spec)) {
    if (input[key] === undefined) continue;
    out[key] = castValue(key, type, input[key]);
  }
  return out;
}

// Replaces schema `required: true`; message mirrors Mongoose's. fix: reported as 400 instead of a wrapped 500.
export function requireFields(data: Record<string, any>, fields: string[], model: string) {
  const missing = fields.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
  if (missing.length > 0) {
    const detail = missing.map((f) => `${f}: Path \`${f}\` is required.`).join(', ');
    throw new ValidationError(`${model} validation failed: ${detail}`);
  }
}
