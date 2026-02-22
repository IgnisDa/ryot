import { z } from "zod";

const configSchema = z.object({
	redisUrl: z.string(),
	databaseUrl: z.string(),
	frontendUrl: z.string(),
	serverAdminAccessToken: z.string(),
});

export type Config = z.infer<typeof configSchema>;

export const config = configSchema.parse({
	redisUrl: process.env.REDIS_URL,
	databaseUrl: process.env.DATABASE_URL,
	frontendUrl: process.env.FRONTEND_URL,
	serverAdminAccessToken: process.env.SERVER_ADMIN_ACCESS_TOKEN,
});
