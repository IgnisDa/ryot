export const entitySchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "show", scriptSlug: "show.tmdb" },
		{ schemaSlug: "show", scriptSlug: "show.tvdb" },
		{ schemaSlug: "movie", scriptSlug: "movie.tvdb" },
		{ schemaSlug: "movie", scriptSlug: "movie.tmdb" },
		{ schemaSlug: "music", scriptSlug: "music.spotify" },
		{ schemaSlug: "manga", scriptSlug: "manga.anilist" },
		{ schemaSlug: "anime", scriptSlug: "anime.anilist" },
		{ schemaSlug: "book", scriptSlug: "book.hardcover" },
		{ schemaSlug: "book", scriptSlug: "book.openlibrary" },
		{ schemaSlug: "book", scriptSlug: "book.google-books" },
		{ schemaSlug: "podcast", scriptSlug: "podcast.itunes" },
		{ schemaSlug: "music", scriptSlug: "music.music-brainz" },
		{ schemaSlug: "anime", scriptSlug: "anime.myanimelist" },
		{ schemaSlug: "manga", scriptSlug: "manga.myanimelist" },
		{ schemaSlug: "manga", scriptSlug: "manga.manga-updates" },
		{ schemaSlug: "music", scriptSlug: "music.youtube-music" },
		{ schemaSlug: "video-game", scriptSlug: "video-game.igdb" },
		{ schemaSlug: "audiobook", scriptSlug: "audiobook.audible" },
		{ schemaSlug: "podcast", scriptSlug: "podcast.listennotes" },
		{ schemaSlug: "comic-book", scriptSlug: "comic-book.metron" },
		{ schemaSlug: "visual-novel", scriptSlug: "visual-novel.vndb" },
		{ schemaSlug: "video-game", scriptSlug: "video-game.giant-bomb" },
	] as const;

export const fitnessSchemaSandboxScriptLinks = () =>
	[{ schemaSlug: "exercise", scriptSlug: "exercise.free-exercise-db" }] as const;

export const builtinEventAutomationRuleLinks = () =>
	[
		{
			metadata: {},
			position: 1000,
			kind: "subscription",
			eventSchemaSlug: "progress",
			name: "Auto-Complete on Full Progress",
			scriptSlug: "trigger.auto-complete-on-full-progress",
		},
		{
			metadata: {},
			position: 100,
			kind: "policy",
			eventSchemaSlug: "progress",
			name: "Integration Progress Policy",
			scriptSlug: "trigger.integration-progress-policy",
		},
		{
			metadata: {},
			position: 1000,
			name: "Radarr Push",
			kind: "subscription",
			scriptSlug: "trigger.radarr-push",
			eventSchemaSlug: "add-entity-to-collection",
		},
		{
			metadata: {},
			position: 1000,
			name: "Sonarr Push",
			kind: "subscription",
			scriptSlug: "trigger.sonarr-push",
			eventSchemaSlug: "add-entity-to-collection",
		},
		{
			metadata: {},
			position: 1000,
			kind: "subscription",
			name: "Jellyfin Push",
			eventSchemaSlug: "complete",
			scriptSlug: "trigger.jellyfin-push",
		},
	] as const;

export const personSchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "person", scriptSlug: "person.tmdb" },
		{ schemaSlug: "person", scriptSlug: "person.tvdb" },
		{ schemaSlug: "person", scriptSlug: "person.metron" },
		{ schemaSlug: "person", scriptSlug: "person.anilist" },
		{ schemaSlug: "person", scriptSlug: "person.audible" },
		{ schemaSlug: "person", scriptSlug: "person.spotify" },
		{ schemaSlug: "person", scriptSlug: "person.hardcover" },
		{ schemaSlug: "person", scriptSlug: "person.music-brainz" },
		{ schemaSlug: "person", scriptSlug: "person.openlibrary" },
		{ schemaSlug: "person", scriptSlug: "person.youtube-music" },
		{ schemaSlug: "person", scriptSlug: "person.giant-bomb" },
		{ schemaSlug: "person", scriptSlug: "person.manga-updates" },
	] as const;

export const companySchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "company", scriptSlug: "company.igdb" },
		{ schemaSlug: "company", scriptSlug: "company.tmdb" },
		{ schemaSlug: "company", scriptSlug: "company.tvdb" },
		{ schemaSlug: "company", scriptSlug: "company.vndb" },
		{ schemaSlug: "company", scriptSlug: "company.anilist" },
		{ schemaSlug: "company", scriptSlug: "company.hardcover" },
		{ schemaSlug: "company", scriptSlug: "company.giant-bomb" },
	] as const;

export const groupSchemaSandboxScriptLinks = () =>
	[
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tmdb" },
		{ schemaSlug: "movie-group", scriptSlug: "movie-group.tvdb" },
		{ schemaSlug: "book-group", scriptSlug: "book-group.hardcover" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.spotify" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.music-brainz" },
		{ schemaSlug: "music-group", scriptSlug: "music-group.youtube-music" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.igdb" },
		{ schemaSlug: "audiobook-group", scriptSlug: "audiobook-group.audible" },
		{ schemaSlug: "comic-book-group", scriptSlug: "comic-book-group.metron" },
		{ schemaSlug: "video-game-group", scriptSlug: "video-game-group.giant-bomb" },
	] as const;
