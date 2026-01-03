import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, serverVariables, TEMP_DIRECTORY } from "~/lib/config.server";

let hasRunStartup = false;

export const loader = async () => {
	if (!hasRunStartup) {
		migrate(db, { migrationsFolder: "app/drizzle/migrations" }).catch(
			(error) => {
				console.error("Database migrations failed", error);
				process.exit(1);
			},
		);
		writeFileSync(
			`${TEMP_DIRECTORY}/website-config.json`,
			JSON.stringify(serverVariables, null, 2),
		);
		hasRunStartup = true;
	}
	try {
		await db.execute(sql`SELECT 1`);
		return new Response("OK", { status: 200 });
	} catch (error) {
		console.error("Health check failed:", error);
		return new Response("Database connection failed", { status: 503 });
	}
};
