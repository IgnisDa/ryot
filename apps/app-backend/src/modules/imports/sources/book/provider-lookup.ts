import { appConfig } from "~/lib/config";

import { sanitizeErrorMessage } from "../../helpers";
import type { ImportEntityRef } from "../../jobs";
import { normalizeIsbn } from "./shared";

const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";
const HARDCOVER_URL = "https://api.hardcover.app/v1/graphql";
const OPEN_LIBRARY_URL = "https://openlibrary.org";

type BookProviderLookupDeps = {
	fetch: typeof fetch;
	getAppConfig: () => {
		hardcoverApiKey?: string;
		googleBooksApiKey?: string;
	};
};

const bookProviderLookupDeps: BookProviderLookupDeps = {
	fetch,
	getAppConfig: () => ({
		hardcoverApiKey: appConfig.books.hardcover.apiKey,
		googleBooksApiKey: appConfig.books.googleBooks.apiKey,
	}),
};

const extractKeySegment = (value: string | undefined): string | undefined => {
	if (!value) {
		return undefined;
	}
	const segment = value.split("/").findLast((part) => part.length > 0);
	const trimmed = segment?.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed;
};

const fetchJson = async <T>(
	deps: BookProviderLookupDeps,
	input: RequestInit & { url: string },
	errorPrefix: string,
): Promise<T> => {
	const response = await deps.fetch(input.url, input);
	if (!response.ok) {
		throw new Error(`${errorPrefix} request failed with status ${response.status}`);
	}
	// oxlint-disable-next-line no-unsafe-type-assertion
	return (await response.json()) as T;
};

const lookupHardcoverBookId = async (
	deps: BookProviderLookupDeps,
	isbn: string,
	apiKey: string,
): Promise<string | undefined> => {
	for (const isbnType of ["10", "13"] as const) {
		const query = `query { editions(where: { isbn_${isbnType}: { _eq: "${isbn}" } }) { book_id } }`;
		// oxlint-disable-next-line no-await-in-loop
		const payload = await fetchJson<{ data?: { editions?: Array<{ book_id?: number | string }> } }>(
			deps,
			{
				method: "POST",
				url: HARDCOVER_URL,
				body: JSON.stringify({ query }),
				headers: { Authorization: apiKey, "Content-Type": "application/json" },
			},
			"Hardcover ISBN lookup",
		);
		const bookId = payload.data?.editions?.[0]?.book_id;
		if (bookId !== undefined) {
			const normalized = String(bookId).trim();
			if (normalized) {
				return normalized;
			}
		}
	}

	return undefined;
};

const lookupGoogleBookId = async (
	deps: BookProviderLookupDeps,
	isbn: string,
	apiKey: string,
): Promise<string | undefined> => {
	const params = new URLSearchParams({ maxResults: "1", printType: "books", q: `isbn:${isbn}` });
	const payload = await fetchJson<{ items?: Array<{ id?: string }> }>(
		deps,
		{ headers: { "x-goog-api-key": apiKey }, url: `${GOOGLE_BOOKS_URL}?${params.toString()}` },
		"Google Books ISBN lookup",
	);
	const id = payload.items?.[0]?.id?.trim();
	if (!id) {
		return undefined;
	}
	return id;
};

const lookupOpenLibraryWorkId = async (
	deps: BookProviderLookupDeps,
	isbn: string,
): Promise<string | undefined> => {
	const payload = await fetchJson<{
		key?: string;
		works?: Array<{ key?: string }>;
	}>(deps, { url: `${OPEN_LIBRARY_URL}/isbn/${isbn}.json` }, "OpenLibrary ISBN lookup");

	const workKey = payload.works?.map((work) => work.key).find(Boolean);
	const resolved =
		extractKeySegment(workKey) ??
		(payload.key?.startsWith("/works/") ? extractKeySegment(payload.key) : undefined);
	return resolved;
};

export const resolveBookEntityRefByIsbn = async (
	input: { isbn: string; sourceLabel: string },
	deps: BookProviderLookupDeps = bookProviderLookupDeps,
): Promise<ImportEntityRef | null> => {
	const isbn = normalizeIsbn(input.isbn);
	if (!isbn) {
		return null;
	}

	const { hardcoverApiKey, googleBooksApiKey } = deps.getAppConfig();
	const failures: string[] = [];
	const providers: Array<{
		label: string;
		scriptSlug: string;
		lookup: () => Promise<string | undefined>;
	}> = [
		{
			label: "OpenLibrary",
			scriptSlug: "book.openlibrary",
			lookup: () => lookupOpenLibraryWorkId(deps, isbn),
		},
		...(hardcoverApiKey
			? [
					{
						label: "Hardcover",
						scriptSlug: "book.hardcover",
						lookup: () => lookupHardcoverBookId(deps, isbn, hardcoverApiKey),
					},
				]
			: []),
		...(googleBooksApiKey
			? [
					{
						label: "Google Books",
						scriptSlug: "book.google-book",
						lookup: () => lookupGoogleBookId(deps, isbn, googleBooksApiKey),
					},
				]
			: []),
	];

	for (const provider of providers) {
		try {
			// oxlint-disable-next-line no-await-in-loop
			const externalId = await provider.lookup();
			if (externalId) {
				return {
					externalId,
					entitySchemaSlug: "book",
					sourceLabel: input.sourceLabel,
					scriptSlug: provider.scriptSlug,
				};
			}
		} catch (error) {
			failures.push(`${provider.label}: ${sanitizeErrorMessage(error, "lookup failed")}`);
		}
	}

	if (failures.length > 0) {
		throw new Error(failures.join("; "));
	}

	return null;
};
