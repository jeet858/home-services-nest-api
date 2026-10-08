import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 reads the connection URL here instead of schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations need a direct (non-pooled) connection when one is provided.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
