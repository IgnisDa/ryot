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
	const legacyStart = performance.now();
	await renameLegacyTables(db);
	await migrate(db, { migrationsFolder });
	await seedInitialDatabase(db);
	await migrateLegacyTables(db);
	await dropLegacyTables(db);
	console.info(
		`[legacy-bootstrap] total elapsed: ${((performance.now() - legacyStart) / 1000).toFixed(1)}s`,
	);
};
