import { z } from "@hono/zod-openapi";
import { dataSchema } from "~/lib/openapi";

const userProviderLanguagePreferencesSchema = z.object({
	source: z.string(),
	preferredLanguage: z.string(),
});

const userLanguagePreferencesSchema = z.object({
	providers: z.array(userProviderLanguagePreferencesSchema),
});

export const userPreferencesSchema = z.object({
	languages: userLanguagePreferencesSchema,
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const defaultUserPreferences: UserPreferences = {
	languages: {
		providers: [
			{ source: "audible", preferredLanguage: "US" },
			{ source: "anilist", preferredLanguage: "user_preferred" },
		],
	},
};

export const meResponseSchema = dataSchema(
	z.object({
		user: z.unknown(),
		session: z.unknown().nullish(),
	}),
);

export const signUpBody = z.object({
	name: z.string().min(1),
	email: z.email().min(1),
	password: z.string().min(8),
});

export const signUpResponseSchema = dataSchema(
	z.object({ created: z.literal(true) }),
);
