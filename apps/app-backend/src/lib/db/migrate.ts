import { migrate } from "drizzle-orm/node-postgres/migrator";

import {
	dropLegacyTables,
	migrateLegacyTables,
	renameLegacyTables,
} from "~/modules/legacy-bootstrap";

import { db } from "./index";
import { seedInitialDatabase } from "./seed";

const migrationsFolder = `${process.cwd()}/src/drizzle`;

export const migrateDB = async () => {
	await renameLegacyTables(db);
	await migrate(db, { migrationsFolder });
	await seedInitialDatabase(db);
	await migrateLegacyTables(db);
	await dropLegacyTables(db);
};
