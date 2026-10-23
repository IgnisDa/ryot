import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord, strictStruct } from "@ryot-app/plugin-backend-sdk/wire";

import { recognizedMediaGenres } from "../../../../shared/media-genres";
import { MediaSandboxError } from "../../../lib/failures";
import { mediaGenreGroups } from "../../../lib/media-genres";
import { decodeJsonResponse } from "../../../lib/records";
import { normalizeRichDescription } from "../../../lib/rich-description";

type GoogleBooksHost = Pick<ScriptHost, "httpCall" | "getPluginConfig">;

const GOOGLE_BOOKS_BASE_URL = "https://www.googleapis.com/books/v1";
const googleBooksSearchOptionsSchema = strictStruct({
	passRawQuery: Schema.optional(Schema.Boolean),
});

const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const getGoogleBooksApiKey = (host: GoogleBooksHost) =>
	host.getPluginConfig({ required: ["googleBooksApiKey"] }).pipe(
		Effect.map(({ googleBooksApiKey }) => googleBooksApiKey),
		Effect.flatMap((value) => {
			const apiKey = stringValue(value);
			if (!apiKey) {
				return Effect.fail(
					new MediaSandboxError({ message: "googleBooksApiKey is not configured" }),
				);
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
			Effect.mapError((error) => ({ ...error, message: error.message || failureMessage })),
			Effect.flatMap((response) => decodeJsonResponse(response.body, "Google Books")),
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
		unlinkedCreators.push({ name, role: "Author" });
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

const collectGenres = Effect.fnUntraced(function* (categories: unknown, mainCategory: unknown) {
	if (
		(categories === undefined || categories === null) &&
		(mainCategory === undefined || mainCategory === null)
	) {
		return null;
	}
	if (categories !== undefined && categories !== null && !Array.isArray(categories)) {
		return yield* new MediaSandboxError({ message: "Google Books categories must be an array" });
	}
	const candidates: string[] = [];
	for (const category of Array.isArray(categories) ? categories : []) {
		if (typeof category !== "string") {
			continue;
		}
		candidates.push(...category.split(" / ").map((token) => token.trim()));
	}
	const trimmedMainCategory = stringValue(mainCategory);
	if (trimmedMainCategory) {
		candidates.push(trimmedMainCategory);
	}
	return recognizedMediaGenres(candidates);
});

export const manifest = defineManifest({
	kind: "provider",
	name: "Google Books",
	slug: "book.google-books",
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		Effect.gen(function* () {
			const options = yield* Schema.decodeEffect(googleBooksSearchOptionsSchema)(
				input.options ?? {},
			);
			const apiKey = yield* getGoogleBooksApiKey(host);
			const params = new URLSearchParams({
				printType: "books",
				maxResults: String(input.pageSize),
				startIndex: String((input.page - 1) * input.pageSize),
				q: options.passRawQuery ? input.query : `intitle:${input.query}`,
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
						title,
						externalId,
						...(image === null ? {} : { imageUrl: image }),
						...(publishYear === null ? {} : { metadata: [publishYear] as const }),
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
				return yield* new MediaSandboxError({ message: "Google Books payload is missing title" });
			}
			const genres = yield* collectGenres(volumeInfo?.["categories"], volumeInfo?.["mainCategory"]);
			const pageCount = numberValue(volumeInfo?.["pageCount"]);
			return {
				name: title,
				...(genres === null ? {} : { relatedEntityGroups: mediaGenreGroups("book", genres) }),
				properties: {
					pages: pageCount === null ? null : Math.trunc(pageCount),
					publishYear: parsePublishYear(volumeInfo?.["publishedDate"]),
					sourceUrl: `https://www.google.co.in/books/edition/${title}/${externalId}`,
					unlinkedCreators: collectUnlinkedCreators(
						volumeInfo?.["authors"],
						volumeInfo?.["publisher"],
					),
					description: yield* normalizeRichDescription(
						volumeInfo?.["description"],
						"https://books.google.com",
					),
					images: collectImages(volumeInfo?.["imageLinks"]).map((url) => ({
						url,
						type: "remote" as const,
						purpose: "cover" as const,
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
			return Effect.fail(
				new MediaSandboxError({ message: "Google Books resolve supports only isbn identifiers" }),
			);
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
