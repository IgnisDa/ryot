import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb, getServerVariables, TEMP_DIRECTORY } from "~/lib/config.server";
import { runMigrations } from "~/lib/migrations.server";

let hasRunStartup = false;

export const loader = async () => {
	const serverVariables = getServerVariables();
	try {
		if (!hasRunStartup) {
			await runMigrations();
			writeFileSync(
				`${TEMP_DIRECTORY}/website-config.json`,
				JSON.stringify(serverVariables, null, 2),
			);
			hasRunStartup = true;
		}
		await getDb().execute(sql`SELECT 1`);
		return new Response("OK", { status: 200 });
	} catch (error) {
		console.error("Health check failed:", error);
		return new Response("Database connection failed", { status: 503 });
	}
};
