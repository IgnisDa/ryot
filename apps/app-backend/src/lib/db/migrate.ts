import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "./index";
import { seedInitialDatabase } from "./seed";

const migrationsFolder = `${process.cwd()}/src/drizzle`;

export const migrateDB = async () => {
	await migrate(db, { migrationsFolder });
	await seedInitialDatabase(db);
};
