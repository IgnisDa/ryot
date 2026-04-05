import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { toTitleCase } from "../../../script-helpers/title-case";

type GoogleBooksHost = SandboxHost<readonly ["httpCall", "getAppConfigValue"]>;

type UnknownRecord = Record<string, unknown>;

const GOOGLE_BOOKS_BASE_URL = "https://www.googleapis.com/books/v1";

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("Google Books returned invalid JSON");
	}
};

const getGoogleBooksApiKey = (host: GoogleBooksHost) =>
	host.getAppConfigValue("books.googleBooksApiKey").pipe(
		Effect.flatMap((value) => {
			const apiKey = stringValue(value);
			if (!apiKey) {
				return Effect.fail(new Error("BOOKS_GOOGLE_BOOKS_API_KEY is not configured"));
			}
			return Effect.succeed(apiKey);
		}),
	);

const googleBooksGet = (
	host: GoogleBooksHost,
	path: string,
	apiKey: string,
	failureMessage: string,
) =>
	host
		.httpCall("GET", `${GOOGLE_BOOKS_BASE_URL}${path}`, { headers: { "x-goog-api-key": apiKey } })
		.pipe(
			Effect.mapError((error) => new Error(error.message || failureMessage)),
			Effect.flatMap((response) =>
				Effect.try({
					try: () => parseJsonResponse(response.body),
					catch: (error) => (error instanceof Error ? error : new Error(String(error))),
				}),
			),
		);

const parsePublishYear = (publishedDate: unknown) => {
	if (typeof publishedDate !== "string" || !publishedDate.trim()) {
		return null;
	}
	const parsed = DateTime.make(publishedDate.trim());
	if (Option.isNone(parsed)) {
		return null;
	}
	return DateTime.toDateUtc(parsed.value).getFullYear();
};

const IMAGE_LINK_KEYS = [
	"thumbnail",
	"smallThumbnail",
	"small",
	"medium",
	"large",
	"extraLarge",
] as const;

const collectImages = (imageLinks: unknown) => {
	const record = asRecord(imageLinks);
	if (!record) {
		return [];
	}
	const imageSet = new Set<string>();
	for (const key of IMAGE_LINK_KEYS) {
		const url = stringValue(record[key]);
		if (url) {
			imageSet.add(url);
		}
	}
	return [...imageSet];
};

const pickImage = (imageLinks: unknown) => {
	const record = asRecord(imageLinks);
	if (!record) {
		return null;
	}
	for (const key of IMAGE_LINK_KEYS) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate;
		}
	}
	return null;
};

const collectUnlinkedCreators = (authors: unknown, publisher: unknown) => {
	const unlinkedCreators: Array<{ role: string; name: string }> = [];
	const seen = new Set<string>();
	for (const author of Array.isArray(authors) ? authors : []) {
		const name = stringValue(author);
		if (!name) {
			continue;
		}
		const key = `Author:${name}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unlinkedCreators.push({ role: "Author", name });
	}
	const publisherName = stringValue(publisher);
	if (publisherName) {
		const key = `Publisher:${publisherName}`;
		if (!seen.has(key)) {
			seen.add(key);
			unlinkedCreators.push({ role: "Publisher", name: publisherName });
		}
	}
	return unlinkedCreators;
};

const collectGenres = (categories: unknown, mainCategory: unknown) => {
	const genreSet = new Set<string>();
	for (const category of Array.isArray(categories) ? categories : []) {
		if (typeof category !== "string") {
			continue;
		}
		for (const token of category.split(" / ")) {
			const titleToken = toTitleCase(token.trim());
			if (titleToken) {
				genreSet.add(titleToken);
			}
		}
	}
	const trimmedMainCategory = stringValue(mainCategory);
	if (trimmedMainCategory) {
		genreSet.add(trimmedMainCategory);
	}
	return [...genreSet];
};

export const manifest = defineManifest({
	kind: "provider",
	name: "Google Books",
	slug: "book.google-books",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["books.googleBooksApiKey"],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		Effect.gen(function* () {
			const apiKey = yield* getGoogleBooksApiKey(host);
			const params = new URLSearchParams({
				printType: "books",
				q: `intitle:${input.query}`,
				maxResults: String(input.pageSize),
				startIndex: String((input.page - 1) * input.pageSize),
			});
			const payloadValue = yield* googleBooksGet(
				host,
				`/volumes?${params.toString()}`,
				apiKey,
				"Google Books search request failed",
			);
			const payload = asRecord(payloadValue);
			const totalItemsValue = numberValue(payload?.["totalItems"]);
			const totalItems = totalItemsValue === null ? 0 : Math.max(0, Math.trunc(totalItemsValue));
			const volumes = payload?.["items"];
			const items = (Array.isArray(volumes) ? volumes : []).flatMap((volume) => {
				const record = asRecord(volume);
				const externalId = stringValue(record?.["id"]);
				const volumeInfo = asRecord(record?.["volumeInfo"]);
				const title = stringValue(volumeInfo?.["title"]);
				if (!externalId || !title) {
					return [];
				}
				const image = pickImage(volumeInfo?.["imageLinks"]);
				const publishYear = parsePublishYear(volumeInfo?.["publishedDate"]);
				return [
					{
						externalId,
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty: image
							? { kind: "image" as const, value: { type: "remote" as const, url: image } }
							: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
					},
				];
			});
			return {
				items,
				details: {
					totalItems,
					nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
				},
			};
		}),
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			const apiKey = yield* getGoogleBooksApiKey(host);
			const payloadValue = yield* googleBooksGet(
				host,
				`/volumes/${encodeURIComponent(input.externalId)}`,
				apiKey,
				"Google Books details request failed",
			);
			const payload = asRecord(payloadValue);
			const externalId =
				typeof payload?.["id"] === "string" && payload["id"].trim()
					? payload["id"]
					: input.externalId;
			const volumeInfo = asRecord(payload?.["volumeInfo"]);
			const title = stringValue(volumeInfo?.["title"]);
			if (!title) {
				return yield* Effect.fail(new Error("Google Books payload is missing title"));
			}
			const pageCount = numberValue(volumeInfo?.["pageCount"]);
			return {
				name: title,
				properties: {
					pages: pageCount === null ? null : Math.trunc(pageCount),
					sourceUrl: `https://www.google.co.in/books/edition/${title}/${externalId}`,
					publishYear: parsePublishYear(volumeInfo?.["publishedDate"]),
					genres: collectGenres(volumeInfo?.["categories"], volumeInfo?.["mainCategory"]),
					description:
						typeof volumeInfo?.["description"] === "string" ? volumeInfo["description"] : null,
					unlinkedCreators: collectUnlinkedCreators(
						volumeInfo?.["authors"],
						volumeInfo?.["publisher"],
					),
					images: collectImages(volumeInfo?.["imageLinks"]).map((url) => ({
						url,
						type: "remote" as const,
					})),
				},
			};
		}),
});

export const resolve = defineProvider({
	manifest,
	operation: "resolve",
	run: (input, host) => {
		if (input.identifierType !== "isbn") {
			return Effect.fail(new Error("Google Books resolve supports only isbn identifiers"));
		}
		const params = new URLSearchParams({
			maxResults: "1",
			printType: "books",
			q: `isbn:${input.value}`,
		});
		return Effect.gen(function* () {
			const apiKey = yield* getGoogleBooksApiKey(host);
			const payloadValue = yield* googleBooksGet(
				host,
				`/volumes?${params.toString()}`,
				apiKey,
				"Google Books ISBN lookup failed",
			);
			const payload = asRecord(payloadValue);
			const items = payload?.["items"];
			const firstId = stringValue(asRecord(Array.isArray(items) ? items[0] : undefined)?.["id"]);
			return { externalId: firstId };
		});
	},
});
