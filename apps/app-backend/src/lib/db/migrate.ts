import { migrate } from "drizzle-orm/node-postgres/migrator";

import { migrateLegacyUsers, renameConflictingTables } from "~/modules/_migration";

import { db } from "./index";
import { seedInitialDatabase } from "./seed";

const migrationsFolder = `${process.cwd()}/src/drizzle`;

export const migrateDB = async () => {
	await renameConflictingTables(db);
	await migrate(db, { migrationsFolder });
	await migrateLegacyUsers(db);
	await seedInitialDatabase(db);
};
