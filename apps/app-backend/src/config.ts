import { z } from "zod";

const configSchema = z.object({
	PORT: z.string(),
	REDIS_URL: z.string(),
	DATABASE_URL: z.string(),
	FRONTEND_URL: z.string(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
});

export type Config = z.infer<typeof configSchema>;

export const config = configSchema.parse(process.env);
