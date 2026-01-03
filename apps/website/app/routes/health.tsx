import { sql } from "drizzle-orm";
import { db } from "~/lib/config.server";

export const loader = async () => {
	try {
		await db.execute(sql`SELECT 1`);
		return new Response("OK", { status: 200 });
	} catch (error) {
		console.error("Health check failed:", error);
		return new Response("Database connection failed", { status: 503 });
	}
};
