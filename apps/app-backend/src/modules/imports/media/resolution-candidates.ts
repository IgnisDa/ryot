import { importerConfig } from "../runtime/importer-config";

const resolutionCandidatesBySchema: Record<string, Partial<Record<string, () => string[]>>> = {
	show: { imdb: () => (importerConfig.moviesAndShows.tmdb.accessToken ? ["show.tmdb"] : []) },
	movie: { imdb: () => (importerConfig.moviesAndShows.tmdb.accessToken ? ["movie.tmdb"] : []) },
	book: {
		isbn: () => [
			"book.openlibrary",
			...(importerConfig.books.googleBooks.apiKey ? ["book.google-book"] : []),
			...(importerConfig.books.hardcover.apiKey ? ["book.hardcover"] : []),
		],
	},
};

export const getResolutionCandidates = (input: {
	identifierType: string;
	entitySchemaSlug: string;
}): string[] =>
	resolutionCandidatesBySchema[input.entitySchemaSlug]?.[input.identifierType]?.() ?? [];
