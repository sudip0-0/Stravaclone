import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { z } from 'zod';

const migrationEnvironmentSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) =>
        value.startsWith('postgres://') || value.startsWith('postgresql://'),
    ),
});

async function runMigration(): Promise<void> {
  const result = migrationEnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      'Invalid migration environment configuration: DATABASE_URL',
    );
  }
  const client = postgres(result.data.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
    });
    process.stdout.write('Database migrations applied successfully\n');
  } finally {
    await client.end({ timeout: 5 });
  }
}

runMigration().catch(() => {
  process.stderr.write('Database migration failed\n');
  process.exitCode = 1;
});
