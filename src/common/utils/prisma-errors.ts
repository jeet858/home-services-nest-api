import { Prisma } from '../../generated/prisma/client';

// Mongo's findOneAndUpdate/Delete return null when nothing matched; Prisma throws P2025 instead.
export async function orNull<T>(query: Promise<T>): Promise<T | null> {
  try {
    return await query;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return null;
    throw error;
  }
}

// FK violation (P2003): the row is still referenced elsewhere.
export const isForeignKeyError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
