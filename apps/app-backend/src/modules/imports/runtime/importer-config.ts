const readEnv = (name: string): string | undefined => {
	const value = process.env[name];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

export const importerConfig = {
	trakt: {
		get clientId() {
			return readEnv("SERVER_IMPORTER_TRAKT_CLIENT_ID");
		},
	},
	books: {
		hardcover: {
			get apiKey() {
				return readEnv("BOOKS_HARDCOVER_API_KEY");
			},
		},
	},
	animeAndManga: {
		mal: {
			get clientId() {
				return readEnv("ANIME_AND_MANGA_MAL_CLIENT_ID");
			},
		},
	},
	moviesAndShows: {
		tmdb: {
			get accessToken() {
				return readEnv("MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN");
			},
		},
	},
	videoGames: {
		giantBomb: {
			get apiKey() {
				return readEnv("VIDEO_GAMES_GIANT_BOMB_API_KEY");
			},
		},
		twitch: {
			get clientId() {
				return readEnv("VIDEO_GAMES_TWITCH_CLIENT_ID");
			},
			get clientSecret() {
				return readEnv("VIDEO_GAMES_TWITCH_CLIENT_SECRET");
			},
		},
	},
};
