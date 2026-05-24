import { appConfig } from "~/lib/config";

const resolutionCandidatesBySchema: Record<string, Partial<Record<string, () => string[]>>> = {
	show: { imdb: () => (appConfig.moviesAndShows.tmdb.accessToken ? ["show.tmdb"] : []) },
	movie: { imdb: () => (appConfig.moviesAndShows.tmdb.accessToken ? ["movie.tmdb"] : []) },
	book: {
		isbn: () => [
			"book.openlibrary",
			...(appConfig.books.hardcover.apiKey ? ["book.hardcover"] : []),
			...(appConfig.books.googleBooks.apiKey ? ["book.google-book"] : []),
		],
	},
};

export const getResolutionCandidates = (input: {
	identifierType: string;
	entitySchemaSlug: string;
}): string[] =>
	resolutionCandidatesBySchema[input.entitySchemaSlug]?.[input.identifierType]?.() ?? [];
