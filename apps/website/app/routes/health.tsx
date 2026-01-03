import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb, getServerVariables, TEMP_DIRECTORY } from "~/lib/config.server";

let hasRunStartup = false;

export const loader = async () => {
	const serverVariables = getServerVariables();
	try {
		if (!hasRunStartup) {
			await migrate(getDb(), { migrationsFolder: "app/drizzle/migrations" });
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
