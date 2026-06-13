import type { ImporterConfig } from "../runtime/importer-config";

const resolutionCandidatesBySchema: Record<
	string,
	Partial<Record<string, (importer: ImporterConfig) => string[]>>
> = {
	show: { imdb: (importer) => (importer.moviesAndShows.tmdb.accessToken ? ["show.tmdb"] : []) },
	movie: { imdb: (importer) => (importer.moviesAndShows.tmdb.accessToken ? ["movie.tmdb"] : []) },
	book: {
		isbn: (importer) => [
			"book.openlibrary",
			...(importer.books.googleBooks.apiKey ? ["book.google-books"] : []),
			...(importer.books.hardcover.apiKey ? ["book.hardcover"] : []),
		],
	},
};

export const getResolutionCandidates = (input: {
	identifierType: string;
	entitySchemaSlug: string;
	importer: ImporterConfig;
}): string[] =>
	resolutionCandidatesBySchema[input.entitySchemaSlug]?.[input.identifierType]?.(input.importer) ??
	[];
