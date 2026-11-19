import { definePluginConfig, integerField, stringField } from "@ryot-app/config";
import type { AppNumberPropertyValidation } from "@ryot-app/contract/schema/property-schema";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

const nonNegativeValidation: AppNumberPropertyValidation = { minimum: 0 };

const mediaConfigDefinition = definePluginConfig(PLUGIN_PACKAGE_ID, {
	anilistClientId: stringField({
		description: "Client ID for AniList accounts",
		label: catalogMessage("property.anilist-client-id"),
		hint: catalogMessage("property.anilist-client-id-hint"),
	}),
	metronUsername: stringField({
		label: catalogMessage("property.metron-username"),
		hint: catalogMessage("property.metron-username-hint"),
		description: "Username used to access Metron metadata",
	}),
	traktClientId: stringField({
		label: catalogMessage("property.trakt-client-id"),
		hint: catalogMessage("property.trakt-client-id-hint"),
		description: "Client ID used to import data from Trakt",
	}),
	twitchClientId: stringField({
		label: catalogMessage("property.twitch-client-id"),
		description: "Client ID used to access IGDB metadata",
		hint: catalogMessage("property.twitch-client-id-hint"),
	}),
	tvdbApiKey: stringField({
		secret: true,
		label: catalogMessage("property.tvdb-api-key"),
		hint: catalogMessage("property.tvdb-api-key-hint"),
		description: "API key used to access TVDB metadata",
	}),
	spotifyClientId: stringField({
		label: catalogMessage("property.spotify-client-id"),
		hint: catalogMessage("property.spotify-client-id-hint"),
		description: "Client ID for Spotify metadata & accounts",
	}),
	malClientId: stringField({
		label: catalogMessage("property.myanimelist-client-id"),
		hint: catalogMessage("property.myanimelist-client-id-hint"),
		description: "Client ID used to access MyAnimeList metadata",
	}),
	metronPassword: stringField({
		secret: true,
		label: catalogMessage("property.metron-password"),
		hint: catalogMessage("property.metron-password-hint"),
		description: "Password used to access Metron metadata",
	}),
	tmdbAccessToken: stringField({
		secret: true,
		label: catalogMessage("property.tmdb-access-token"),
		hint: catalogMessage("property.tmdb-access-token-hint"),
		description: "Access token used to access TMDB metadata",
	}),
	hardcoverApiKey: stringField({
		secret: true,
		label: catalogMessage("property.hardcover-api-key"),
		hint: catalogMessage("property.hardcover-api-key-hint"),
		description: "API key used to access Hardcover metadata",
	}),
	giantBombApiKey: stringField({
		secret: true,
		label: catalogMessage("property.giant-bomb-api-key"),
		hint: catalogMessage("property.giant-bomb-api-key-hint"),
		description: "API key used to access Giant Bomb metadata",
	}),
	anilistClientSecret: stringField({
		secret: true,
		description: "Client secret for AniList accounts",
		label: catalogMessage("property.anilist-client-secret"),
		hint: catalogMessage("property.anilist-client-secret-hint"),
	}),
	twitchClientSecret: stringField({
		secret: true,
		label: catalogMessage("property.twitch-client-secret"),
		description: "Client secret used to access IGDB metadata",
		hint: catalogMessage("property.twitch-client-secret-hint"),
	}),
	googleBooksApiKey: stringField({
		secret: true,
		label: catalogMessage("property.google-books-api-key"),
		hint: catalogMessage("property.google-books-api-key-hint"),
		description: "API key used to access Google Books metadata",
	}),
	listennotesApiKey: stringField({
		secret: true,
		label: catalogMessage("property.listen-notes-api-key"),
		hint: catalogMessage("property.listen-notes-api-key-hint"),
		description: "API key used to access Listen Notes metadata",
	}),
	spotifyClientSecret: stringField({
		secret: true,
		label: catalogMessage("property.spotify-client-secret"),
		hint: catalogMessage("property.spotify-client-secret-hint"),
		description: "Client secret for Spotify metadata & accounts",
	}),
	progressUpdateThresholdHours: integerField({
		defaultValue: 2,
		validation: nonNegativeValidation,
		label: catalogMessage("property.progress-update-threshold"),
		hint: catalogMessage("property.progress-update-threshold-hint"),
		description: "Hours used to debounce repeated completion updates",
	}),
});

export const mediaConfigSchema = mediaConfigDefinition.schema;
