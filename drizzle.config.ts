import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATA_DIR ? `${process.env.DATA_DIR}/db/app.sqlite` : './data/db/app.sqlite' }
});
