import type { CreateImportRunBody } from "../schemas";
import { importerConfig } from "./importer-config";

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
	imdb: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	grouvee: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	watcharr: [{ bodyField: "uploadToken", allowedExtensions: ["json"] }],
	hardcover: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	goodreads: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	open_scale: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	storygraph: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
	strong_app: [{ bodyField: "uploadToken", allowedExtensions: ["csv"] }],
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
	imdb: () =>
		importerConfig.moviesAndShows.tmdb.accessToken
			? undefined
			: "IMDb importer is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN.",
	watcharr: () =>
		importerConfig.moviesAndShows.tmdb.accessToken
			? undefined
			: "Watcharr importer is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN.",
};

const getBodyString = (body: CreateImportRunBody, field: string): string | undefined => {
	const value = (body as Record<string, unknown>)[field];
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

export const buildInputSummary = (body: CreateImportRunBody): Record<string, unknown> => ({
	source: body.source,
});
