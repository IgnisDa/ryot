import { z } from "zod";

const configSchema = z.object({
	REDIS_URL: z.string(),
	DATABASE_URL: z.string(),
	FRONTEND_URL: z.string(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
	PORT: z
		.string()
		.default("8000")
		.transform((val) => Number.parseInt(val, 10)),
});

export type Config = z.infer<typeof configSchema>;

export const config = configSchema.parse(process.env);

const appConfigSchema = z.object({
	ANIME_AND_MANGA_MAL_CLIENT_ID: z.string().optional(),
	BOOKS_GOOGLE_BOOKS_API_KEY: z.string().optional(),
	BOOKS_HARDCOVER_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const appConfig = appConfigSchema.parse(process.env);
