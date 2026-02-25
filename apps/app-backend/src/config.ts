import { z } from "zod";

const configSchema = z.object({
	REDIS_URL: z.string(),
	DATABASE_URL: z.string(),
	FRONTEND_URL: z.string(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
	BOOKS_GOOGLE_BOOKS_API_KEY: z.string().optional(),
	PORT: z
		.string()
		.default("8000")
		.transform((val) => Number.parseInt(val, 10)),
});

export type Config = z.infer<typeof configSchema>;

export const config = configSchema.parse(process.env);
