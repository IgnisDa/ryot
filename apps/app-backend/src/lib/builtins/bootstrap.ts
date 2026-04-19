import { Effect } from "effect";

export type UserPreferences = {
	readonly isNsfw: boolean;
	readonly disableIntegrations: boolean;
	readonly languages: {
		readonly providers: ReadonlyArray<{
			readonly source: string;
			readonly preferredLanguage: string;
		}>;
	};
};

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

// TODO(Task 10): Create default trackers, saved views, library entity, etc.
export const bootstrapNewUser = (userId: string) =>
	Effect.logInfo("Bootstrapping new user", { userId });
