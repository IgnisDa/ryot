import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { auth, type MaybeAuthType } from "./auth";
import { withSession } from "./auth/middleware";
import { migrateDB } from "./db";
import { protectedApi } from "./routes/protected";

const app = new Hono<{ Variables: MaybeAuthType }>().basePath("/api");

const route = app
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw))
	.use("*", withSession)
	.route("/protected", protectedApi);

export type AppType = typeof route;

const main = async () => {
	await migrateDB();
	serve({ fetch: app.fetch }, (c) => {
		console.info(`Server listening on port ${c.port}...`);
	});
};

main().catch((err) => {
	console.error("Error starting server:", err);
	process.exit(1);
});
