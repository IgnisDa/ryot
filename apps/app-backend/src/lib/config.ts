import { z } from "zod";

const configSchema = z.object({
	REDIS_URL: z.string(),
	DATABASE_URL: z.string(),
	FRONTEND_URL: z.string(),
	SERVER_ADMIN_ACCESS_TOKEN: z.string(),
	FILE_STORAGE_S3_URL: z.string().nullish(),
	FILE_STORAGE_S3_REGION: z.string().nullish(),
	NODE_ENV: z.string().default("development"),
	FILE_STORAGE_S3_BUCKET_NAME: z.string().nullish(),
	FILE_STORAGE_S3_ACCESS_KEY_ID: z.string().nullish(),
	FILE_STORAGE_S3_SECRET_ACCESS_KEY: z.string().nullish(),
	USERS_ALLOW_REGISTRATION: z
		.string()
		.default("true")
		.transform((val) => val === "true"),
	PORT: z
		.string()
		.default("8000")
		.transform((val) => Number.parseInt(val, 10)),
});

export type Config = z.infer<typeof configSchema>;

export const config = configSchema.parse(process.env);

export const IS_DEVELOPMENT = config.NODE_ENV === "development";

const appConfigSchema = z.object({
	BOOKS_HARDCOVER_API_KEY: z.string().optional(),
	BOOKS_GOOGLE_BOOKS_API_KEY: z.string().optional(),
	ANIME_AND_MANGA_MAL_CLIENT_ID: z.string().optional(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const appConfig = appConfigSchema.parse(process.env);
