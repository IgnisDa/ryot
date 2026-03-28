import { migrate } from "drizzle-orm/node-postgres/migrator";

import {
	dropLegacyTables,
	migrateLegacyTables,
	renameLegacyTables,
} from "~/modules/legacyBootstrap";

import { db } from "./index";
import { seedInitialDatabase } from "./seed";

const migrationsFolder = `${process.cwd()}/src/drizzle`;

export const migrateDB = async () => {
	await migrate(db, { migrationsFolder });
	await seedInitialDatabase(db);
	await db.transaction(async (tx) => {
		await renameLegacyTables(tx);
		await migrateLegacyTables(tx);
		await dropLegacyTables(tx);
	});
};
