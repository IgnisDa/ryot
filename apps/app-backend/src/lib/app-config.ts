export const appConfigKeys = [
	"ANIME_AND_MANGA_MAL_CLIENT_ID",
	"BOOKS_GOOGLE_BOOKS_API_KEY",
	"BOOKS_HARDCOVER_API_KEY",
] as const;

export type AppConfigKey = (typeof appConfigKeys)[number];

export const isAppConfigKey = (key: string): key is AppConfigKey =>
	appConfigKeys.includes(key as AppConfigKey);
