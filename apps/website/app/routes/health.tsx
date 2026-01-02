import { writeFileSync } from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, serverVariables, TEMP_DIRECTORY } from "../lib/config.server";

export const loader = async () => {
	migrate(db, { migrationsFolder: "app/drizzle/migrations" }).catch((error) => {
		console.error("Database migrations failed", error);
		process.exit(1);
	});
	writeFileSync(
		`${TEMP_DIRECTORY}/website-config.json`,
		JSON.stringify(serverVariables, null, 2),
	);
};
