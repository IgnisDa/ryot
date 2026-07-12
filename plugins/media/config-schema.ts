import { definePluginConfig, integerField, stringField } from "@ryot/config";
import type { AppNumberPropertyValidation } from "@ryot/contract/schema/property-schema";

const nonNegativeValidation: AppNumberPropertyValidation = { minimum: 0 };

const mediaConfigDefinition = definePluginConfig("media", {
	tvdbApiKey: stringField({
		secret: true,
		label: "TVDB API key",
		description: "API key used to access TVDB metadata",
	}),
	tmdbAccessToken: stringField({
		secret: true,
		label: "TMDB access token",
		description: "Access token used to access TMDB metadata",
	}),
	malClientId: stringField({
		label: "MyAnimeList client ID",
		description: "Client ID used to access MyAnimeList metadata",
	}),
	metronUsername: stringField({
		label: "Metron username",
		description: "Username used to access Metron metadata",
	}),
	metronPassword: stringField({
		secret: true,
		label: "Metron password",
		description: "Password used to access Metron metadata",
	}),
	hardcoverApiKey: stringField({
		secret: true,
		label: "Hardcover API key",
		description: "API key used to access Hardcover metadata",
	}),
	googleBooksApiKey: stringField({
		secret: true,
		label: "Google Books API key",
		description: "API key used to access Google Books metadata",
	}),
	spotifyClientId: stringField({
		label: "Spotify client ID",
		description: "Client ID used to access Spotify metadata",
	}),
	spotifyClientSecret: stringField({
		secret: true,
		label: "Spotify client secret",
		description: "Client secret used to access Spotify metadata",
	}),
	listennotesApiKey: stringField({
		secret: true,
		label: "Listen Notes API key",
		description: "API key used to access Listen Notes metadata",
	}),
	twitchClientId: stringField({
		label: "Twitch client ID",
		description: "Client ID used to access IGDB metadata",
	}),
	twitchClientSecret: stringField({
		secret: true,
		label: "Twitch client secret",
		description: "Client secret used to access IGDB metadata",
	}),
	giantBombApiKey: stringField({
		secret: true,
		label: "Giant Bomb API key",
		description: "API key used to access Giant Bomb metadata",
	}),
	traktClientId: stringField({
		label: "Trakt client ID",
		description: "Client ID used to import data from Trakt",
	}),
	progressUpdateThresholdHours: integerField({
		defaultValue: 2,
		label: "Progress update threshold",
		validation: nonNegativeValidation,
		description: "Hours used to debounce repeated completion updates",
	}),
});

export const mediaConfigSchema = mediaConfigDefinition.schema;
