import { Config } from "effect";

import { field, group } from "./builder";

export const systemConfigDef = group("Core system configuration", {
	port: field(
		{
			envKey: "PORT",
			description: "HTTP port the server listens on",
			default: "3000",
		},
		Config.integer("PORT").pipe(Config.withDefault(3000)),
	),
	frontendUrl: field(
		{
			envKey: "FRONTEND_URL",
			description: "Public base URL of the frontend application",
			default: "http://localhost:3000",
		},
		Config.string("FRONTEND_URL").pipe(Config.withDefault("http://localhost:3000")),
	),
});
