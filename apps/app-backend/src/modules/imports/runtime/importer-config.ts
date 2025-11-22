import { Option, Redacted } from "effect";

import type { AppConfigValue } from "#lib/config/service";

const toValue = (option: Option.Option<string>): string | undefined =>
	Option.getOrUndefined(option);

const toSecret = (option: Option.Option<Redacted.Redacted>): string | undefined =>
	Option.match(option, { onNone: () => undefined, onSome: Redacted.value });

export const makeImporterConfig = (config: AppConfigValue) => {
	const providers = config.providers;
	return {
		trakt: { clientId: toValue(providers.traktClientId) },
		animeAndManga: { mal: { clientId: toValue(providers.malClientId) } },
		moviesAndShows: { tmdb: { accessToken: toSecret(providers.tmdbAccessToken) } },
		books: {
			hardcover: { apiKey: toSecret(providers.hardcoverApiKey) },
			googleBooks: { apiKey: toSecret(providers.googleBooksApiKey) },
		},
		videoGames: {
			giantBomb: { apiKey: toSecret(providers.giantBombApiKey) },
			twitch: {
				clientId: toValue(providers.twitchClientId),
				clientSecret: toSecret(providers.twitchClientSecret),
			},
		},
	};
};

export type ImporterConfig = ReturnType<typeof makeImporterConfig>;
