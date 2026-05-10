import { migrate } from "drizzle-orm/node-postgres/migrator";

import { migrateLegacyTables, renameLegacyTables } from "~/modules/legacyBootstrap";

import { db } from "./index";
import { seedInitialDatabase } from "./seed";

const migrationsFolder = `${process.cwd()}/src/drizzle`;

export const migrateDB = async () => {
	await db.transaction(async (tx) => {
		await renameLegacyTables(tx);
		await migrate(tx, { migrationsFolder });
		await seedInitialDatabase(tx);
		await migrateLegacyTables(tx);
	});
};
