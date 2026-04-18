import { field, group } from "./types";

export const systemConfigDef = group("Core system configuration", {
	databaseUrl: field("DATABASE_URL", {
		sensitive: true,
		description:
			"PostgreSQL connection string for the primary database. See https://www.sea-ql.org/SeaORM/docs/install-and-config/connection/#postgres",
	}),
	redisUrl: field("REDIS_URL", {
		sensitive: true,
		description: "Redis connection URL used for caching and the job queue",
	}),
	frontendUrl: field("FRONTEND_URL", {
		description: "Public base URL of the frontend application",
	}),
	port: field("PORT", {
		default: "8000",
		description: "HTTP port the backend server listens on",
	}),
	nodeEnv: field("NODE_ENV", {
		default: "production",
		description: "Runtime environment (development | production)",
	}),
	server: group("Server settings", {
		adminAccessToken: field("SERVER_ADMIN_ACCESS_TOKEN", {
			sensitive: true,
			description: "Secret token required for admin API operations",
		}),
	}),
	users: group("User account settings", {
		allowRegistration: field("USERS_ALLOW_REGISTRATION", {
			default: "true",
			description: "Allow new users to self-register on this instance",
		}),
	}),
	fileStorage: group("S3-compatible file storage", {
		url: field("FILE_STORAGE_S3_URL", {
			optional: true,
			description: "Endpoint URL for the S3-compatible storage service",
		}),
		region: field("FILE_STORAGE_S3_REGION", {
			optional: true,
			description: "AWS region or equivalent for the storage service",
		}),
		bucketName: field("FILE_STORAGE_S3_BUCKET_NAME", {
			optional: true,
			description:
				"Name of the storage bucket. Required to enable file storage",
		}),
		accessKeyId: field("FILE_STORAGE_S3_ACCESS_KEY_ID", {
			optional: true,
			sensitive: true,
			description: "Access key ID credential for storage authentication",
		}),
		secretAccessKey: field("FILE_STORAGE_S3_SECRET_ACCESS_KEY", {
			optional: true,
			sensitive: true,
			description: "Secret access key credential for storage authentication",
		}),
	}),
});

export const appConfigDef = group("Provider integration configuration", {
	books: group("Book providers", {
		hardcover: group("Hardcover", {
			apiKey: field("BOOKS_HARDCOVER_API_KEY", {
				optional: true,
				sensitive: true,
				description: "API key for the Hardcover book database",
			}),
		}),
		googleBooks: group("Google Books", {
			apiKey: field("BOOKS_GOOGLE_BOOKS_API_KEY", {
				optional: true,
				sensitive: true,
				description: "API key for the Google Books API",
			}),
		}),
	}),
	animeAndManga: group("Anime and manga providers", {
		mal: group("MyAnimeList", {
			clientId: field("ANIME_AND_MANGA_MAL_CLIENT_ID", {
				optional: true,
				sensitive: true,
				description: "Client ID for the MyAnimeList API",
			}),
		}),
	}),
	music: group("Music providers", {
		spotify: group("Spotify", {
			clientId: field("MUSIC_SPOTIFY_CLIENT_ID", {
				optional: true,
				sensitive: true,
				description: "OAuth client ID from the Spotify developer dashboard",
			}),
			clientSecret: field("MUSIC_SPOTIFY_CLIENT_SECRET", {
				optional: true,
				sensitive: true,
				description: "OAuth client secret from the Spotify developer dashboard",
			}),
		}),
	}),
	podcasts: group("Podcast providers", {
		listenNotes: group("ListenNotes", {
			apiKey: field("PODCASTS_LISTENNOTES_API_KEY", {
				optional: true,
				sensitive: true,
				description: "API key for the ListenNotes podcast search API",
			}),
		}),
	}),
	moviesAndShows: group("Movie and TV show providers", {
		tmdb: group("The Movie Database (TMDB)", {
			accessToken: field("MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN", {
				optional: true,
				sensitive: true,
				description: "Bearer token for the TMDB v4 API",
			}),
		}),
		tvdb: group("TheTVDB", {
			apiKey: field("MOVIES_AND_SHOWS_TVDB_API_KEY", {
				optional: true,
				sensitive: true,
				description: "API key for the TheTVDB API",
			}),
		}),
	}),
	videoGames: group("Video game providers", {
		twitch: group("Twitch (IGDB access)", {
			clientId: field("VIDEO_GAMES_TWITCH_CLIENT_ID", {
				optional: true,
				sensitive: true,
				description:
					"Twitch client ID — required for IGDB API access. See https://api-docs.igdb.com/#account-creation",
			}),
			clientSecret: field("VIDEO_GAMES_TWITCH_CLIENT_SECRET", {
				optional: true,
				sensitive: true,
				description: "Twitch client secret — required for IGDB API access",
			}),
		}),
		giantBomb: group("GiantBomb", {
			apiKey: field("VIDEO_GAMES_GIANT_BOMB_API_KEY", {
				optional: true,
				sensitive: true,
				description: "API key for the GiantBomb video game database",
			}),
		}),
	}),
	comicBooks: group("Comic book providers", {
		metron: group("Metron", {
			username: field("COMIC_BOOK_METRON_USERNAME", {
				optional: true,
				sensitive: true,
				description: "Account username for the Metron comic database",
			}),
			password: field("COMIC_BOOK_METRON_PASSWORD", {
				optional: true,
				sensitive: true,
				description: "Account password for the Metron comic database",
			}),
		}),
	}),
});
