export * as schema from "./schema";

import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const migrationsFolder = resolve(process.cwd(), "drizzle");

export const db = drizzle(process.env.DATABASE_URL);

await migrate(db, { migrationsFolder });
