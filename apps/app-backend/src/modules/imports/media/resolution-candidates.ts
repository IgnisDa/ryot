import { appConfig } from "~/lib/config";

const resolutionCandidatesByType: Record<string, () => string[]> = {
	isbn: () => [
		"book.openlibrary",
		...(appConfig.books.hardcover.apiKey ? ["book.hardcover"] : []),
		...(appConfig.books.googleBooks.apiKey ? ["book.google-book"] : []),
	],
};

export const getResolutionCandidates = (identifierType: string): string[] =>
	resolutionCandidatesByType[identifierType]?.() ?? [];
