import type { CreateImportRunBody } from "../schemas";
import { importerConfig } from "./importer-config";
import { getSourceApiHost, normalizeSourceApiUrl } from "./source-api";

type ImportSourceFileDefinition = {
	bodyField: string;
	required?: boolean;
	payloadKey?: string;
	allowedExtensions: string[];
};

const sourceFileDefinitions: Partial<
	Record<CreateImportRunBody["source"], ImportSourceFileDefinition[]>
> = {
	hevy: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	igdb: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	imdb: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	netflix: [{ bodyField: "uploadToken", allowedExtensions: ["zip"] }],
	grouvee: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	anilist: [{ bodyField: "uploadToken", allowedExtensions: ["json"] }],
	watcharr: [{ bodyField: "uploadToken", allowedExtensions: ["json"] }],
	hardcover: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	goodreads: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	open_scale: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	storygraph: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	strong_app: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	movary: [
		{ allowedExtensions: ["csv"], payloadKey: "historyFilePath", bodyField: "historyUploadToken" },
		{ allowedExtensions: ["csv"], payloadKey: "ratingsFilePath", bodyField: "ratingsUploadToken" },
		{
			allowedExtensions: ["csv"],
			payloadKey: "watchlistFilePath",
			bodyField: "watchlistUploadToken",
		},
	],
	myanimelist: [
		{
			required: false,
			payloadKey: "animeFilePath",
			bodyField: "animeUploadToken",
			allowedExtensions: ["gz", "xml"],
		},
		{
			required: false,
			payloadKey: "mangaFilePath",
			bodyField: "mangaUploadToken",
			allowedExtensions: ["gz", "xml"],
		},
	],
};

const sourceStartValidators: Partial<
	Record<CreateImportRunBody["source"], () => string | undefined>
> = {
	grouvee: () =>
		importerConfig.videoGames.giantBomb.apiKey
			? undefined
			: "Grouvee importer is not configured. Set VIDEO_GAMES_GIANT_BOMB_API_KEY.",
	hardcover: () =>
		importerConfig.books.hardcover.apiKey
			? undefined
			: "Hardcover importer is not configured. Set BOOKS_HARDCOVER_API_KEY.",
	igdb: () =>
		importerConfig.videoGames.twitch.clientId && importerConfig.videoGames.twitch.clientSecret
			? undefined
			: "IGDB importer is not configured. Set VIDEO_GAMES_TWITCH_CLIENT_ID and VIDEO_GAMES_TWITCH_CLIENT_SECRET.",
	imdb: () =>
		importerConfig.moviesAndShows.tmdb.accessToken
			? undefined
			: "IMDb importer is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN.",
	netflix: () =>
		importerConfig.moviesAndShows.tmdb.accessToken
			? undefined
			: "Netflix importer is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN.",
	movary: () =>
		importerConfig.moviesAndShows.tmdb.accessToken
			? undefined
			: "Movary importer is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN.",
	watcharr: () =>
		importerConfig.moviesAndShows.tmdb.accessToken
			? undefined
			: "Watcharr importer is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN.",
	myanimelist: () =>
		importerConfig.animeAndManga.mal.clientId
			? undefined
			: "MyAnimeList importer is not configured. Set ANIME_AND_MANGA_MAL_CLIENT_ID.",
	trakt: () =>
		importerConfig.trakt.clientId
			? undefined
			: "Trakt importer is not configured. Set SERVER_IMPORTER_TRAKT_CLIENT_ID.",
};

const getBodyString = (body: CreateImportRunBody, field: string): string | undefined => {
	const value = Reflect.get(body, field);
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

export const getKnownImportExtensions = (): string[] => [
	...new Set(
		Object.values(sourceFileDefinitions)
			.flat()
			.flatMap((source) => source.allowedExtensions),
	),
];

export const getImportSourceFileInputs = (body: CreateImportRunBody) =>
	(sourceFileDefinitions[body.source] ?? []).map((definition) => ({
		required: definition.required,
		bodyField: definition.bodyField,
		payloadKey: definition.payloadKey,
		allowedExtensions: definition.allowedExtensions,
		uploadToken: getBodyString(body, definition.bodyField),
	}));

export const getImportSourceStartError = (
	source: CreateImportRunBody["source"],
): string | undefined => sourceStartValidators[source]?.();

export const buildInputSummary = (body: CreateImportRunBody): Record<string, unknown> => {
	const summary: Record<string, unknown> = { source: body.source };
	if ("apiUrl" in body) {
		summary.host = getSourceApiHost(body.apiUrl);
		if ("allowInsecureConnections" in body && body.allowInsecureConnections) {
			summary.allowInsecureConnections = true;
		}
	}
	if (body.source === "igdb") {
		summary.collection = body.collection;
	}
	if (body.source === "myanimelist") {
		summary.hasAnimeFile = Boolean(body.animeUploadToken);
		summary.hasMangaFile = Boolean(body.mangaUploadToken);
	}
	if (body.source === "movary") {
		summary.hasHistoryFile = true;
		summary.hasRatingsFile = true;
		summary.hasWatchlistFile = true;
	}
	if (body.source === "netflix") {
		summary.hasExportFile = true;
		summary.hasProfileName = Boolean(body.profileName?.trim());
	}
	if (body.source === "trakt") {
		summary.username = body.username;
	}
	return summary;
};

export const buildSourcePayload = (
	body: CreateImportRunBody,
): Record<string, unknown> | undefined => {
	if (body.source === "igdb") {
		return { collection: body.collection };
	}
	if (body.source === "trakt") {
		return { username: body.username };
	}
	if (body.source === "netflix") {
		const profileName = body.profileName?.trim();
		return profileName ? { profileName } : undefined;
	}
	if (
		body.source === "plex" ||
		body.source === "media_tracker" ||
		body.source === "audiobookshelf"
	) {
		return {
			apiKey: body.apiKey,
			apiUrl: normalizeSourceApiUrl(body.apiUrl),
			...(body.allowInsecureConnections ? { allowInsecureConnections: true } : {}),
		};
	}
	if (body.source === "jellyfin") {
		return {
			username: body.username,
			apiUrl: normalizeSourceApiUrl(body.apiUrl),
			...(body.password ? { password: body.password } : {}),
			...(body.allowInsecureConnections ? { allowInsecureConnections: true } : {}),
		};
	}
	return undefined;
};
