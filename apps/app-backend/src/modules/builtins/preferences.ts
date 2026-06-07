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
	disableIntegrations: z.boolean().default(false),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const defaultUserPreferences: UserPreferences = {
	isNsfw: false,
	disableIntegrations: false,
	languages: {
		providers: [
			{ source: "audible", preferredLanguage: "US" },
			{ source: "anilist", preferredLanguage: "user_preferred" },
		],
	},
};
