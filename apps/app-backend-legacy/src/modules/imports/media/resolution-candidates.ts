import { appConfig } from "~/lib/config";

const resolutionCandidatesBySchema: Record<string, Partial<Record<string, () => string[]>>> = {
	show: { imdb: () => (appConfig.moviesAndShows.tmdb.accessToken ? ["show.tmdb"] : []) },
	movie: { imdb: () => (appConfig.moviesAndShows.tmdb.accessToken ? ["movie.tmdb"] : []) },
	book: {
		isbn: () => [
			"book.openlibrary",
			...(appConfig.books.googleBooks.apiKey ? ["book.google-book"] : []),
			...(appConfig.books.hardcover.apiKey ? ["book.hardcover"] : []),
		],
	},
};

export const getResolutionCandidates = (input: {
	identifierType: string;
	entitySchemaSlug: string;
}): string[] =>
	resolutionCandidatesBySchema[input.entitySchemaSlug]?.[input.identifierType]?.() ?? [];
