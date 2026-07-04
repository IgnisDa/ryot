import { Option, Redacted } from "effect";

import type { AppConfigValue } from "#lib/infrastructure/config/service";

const toValue = (option: Option.Option<string>): string | undefined =>
	Option.getOrUndefined(option);

const toSecret = (option: Option.Option<Redacted.Redacted>): string | undefined =>
	Option.match(option, { onNone: () => undefined, onSome: Redacted.value });

export const makeImporterConfig = (config: AppConfigValue) => {
	return {
		trakt: { clientId: toValue(config.server.traktClientId) },
		animeAndManga: { mal: { clientId: toValue(config.animeAndManga.malClientId) } },
		moviesAndShows: { tmdb: { accessToken: toSecret(config.moviesAndShows.tmdbAccessToken) } },
		books: {
			hardcover: { apiKey: toSecret(config.books.hardcoverApiKey) },
			googleBooks: { apiKey: toSecret(config.books.googleBooksApiKey) },
		},
		videoGames: {
			giantBomb: { apiKey: toSecret(config.videoGames.giantBombApiKey) },
			twitch: {
				clientId: toValue(config.videoGames.twitchClientId),
				clientSecret: toSecret(config.videoGames.twitchClientSecret),
			},
		},
		music: {
			spotify: {
				clientId: toValue(config.music.spotifyClientId),
				clientSecret: toSecret(config.music.spotifyClientSecret),
			},
		},
		podcasts: {
			listennotes: { apiKey: toSecret(config.podcasts.listennotesApiKey) },
		},
	};
};

export type ImporterConfig = ReturnType<typeof makeImporterConfig>;
