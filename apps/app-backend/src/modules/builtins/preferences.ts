import { z } from "@hono/zod-openapi";

const userProviderLanguagePreferencesSchema = z.object({
	source: z.string(),
	preferredLanguage: z.string(),
});

const userLanguagePreferencesSchema = z.object({
	providers: z.array(userProviderLanguagePreferencesSchema),
});

export const userPreferencesSchema = z.object({
	isNsfw: z.boolean().default(false),
	languages: userLanguagePreferencesSchema,
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const defaultUserPreferences: UserPreferences = {
	isNsfw: false,
	languages: {
		providers: [
			{ source: "audible", preferredLanguage: "US" },
			{ source: "anilist", preferredLanguage: "user_preferred" },
		],
	},
};
