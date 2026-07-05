import { Effect, Schema } from "effect";

import { finalizeEntityGroups } from "#modules/imports/media/adapter-helpers";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "#modules/imports/media/adapter-result";
import { nowIso } from "#modules/imports/media/dates";
import { getOrCreateMediaEntityGroup } from "#modules/imports/media/groups";
import type { ImportEntityRef, ImportMediaEntityGroup } from "#modules/imports/media/types";
import { requestSourceJson } from "#modules/imports/runtime/source-api";

const KOMGA_PAGE_SIZE = 500;

const KomgaLink = Schema.Struct({ url: Schema.String, label: Schema.String });

const KomgaBook = Schema.Struct({
	id: Schema.String,
	media: Schema.optional(Schema.Struct({ pagesCount: Schema.optional(Schema.Int) })),
	metadata: Schema.Struct({
		title: Schema.String,
		links: Schema.optionalWith(Schema.Array(KomgaLink), { default: () => [] }),
	}),
	readProgress: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				page: Schema.optional(Schema.Int),
				completed: Schema.optional(Schema.Boolean),
			}),
		),
	),
});

type KomgaBook = typeof KomgaBook.Type;

const KomgaBooksPage = Schema.Struct({
	content: Schema.Array(KomgaBook),
	totalPages: Schema.optional(Schema.Int),
});

const decodeBooksPage = Schema.decodeUnknown(KomgaBooksPage);

type KomgaInput = { apiKey: string; baseUrl: string };

const buildHeaders = (apiKey: string): Record<string, string> => ({
	Accept: "application/json",
	Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
});

export const extractMangaRef = (
	links: ReadonlyArray<{ readonly url: string; readonly label: string }>,
	title: string,
): ImportEntityRef | null => {
	for (const link of links) {
		const label = link.label.toLowerCase();
		const url = link.url;

		if (label === "anilist") {
			const match = url.match(/anilist\.co\/manga\/(\d+)/);
			if (match?.[1]) {
				return {
					kind: "resolved",
					sourceLabel: title,
					externalId: match[1],
					entitySchemaSlug: "manga",
					providerSlug: "manga.anilist",
				};
			}
		}

		if (label === "myanimelist" || label === "mal") {
			const match = url.match(/myanimelist\.net\/manga\/(\d+)/);
			if (match?.[1]) {
				return {
					kind: "resolved",
					sourceLabel: title,
					externalId: match[1],
					entitySchemaSlug: "manga",
					providerSlug: "manga.myanimelist",
				};
			}
		}

		if (label === "mangaupdates") {
			const match = url.match(/mangaupdates\.com\/series\/([^/]+)/);
			if (match?.[1]) {
				return {
					kind: "resolved",
					sourceLabel: title,
					externalId: match[1],
					entitySchemaSlug: "manga",
					providerSlug: "manga.manga-updates",
				};
			}
		}
	}

	return null;
};

const fetchAllKomgaBooks = Effect.fn(function* (input: KomgaInput, readStatus?: string) {
	const headers = buildHeaders(input.apiKey);
	const books: KomgaBook[] = [];
	let page = 0;
	let totalPages = 1;

	while (page < totalPages) {
		const resp = yield* requestSourceJson({
			headers,
			sourceName: "Komga",
			path: "api/v1/books",
			baseUrl: input.baseUrl,
			query: { page, size: KOMGA_PAGE_SIZE, ...(readStatus ? { read_status: readStatus } : {}) },
		}).pipe(Effect.flatMap(decodeBooksPage));
		books.push(...resp.content);
		totalPages = resp.totalPages ?? 1;
		page += 1;
	}

	return books;
});

export const adaptKomgaData = Effect.fn("komga.adaptKomgaData")(function* (input: KomgaInput) {
	const now = nowIso();
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();

	const books = yield* fetchAllKomgaBooks(input, "IN_PROGRESS");

	books.forEach((book, idx) => {
		const title = book.metadata.title;
		const readProgress = book.readProgress;
		if (!readProgress || readProgress.completed) {
			return;
		}

		const pagesCount = book.media?.pagesCount;
		const currentPage = readProgress.page;
		if (!pagesCount || !currentPage || pagesCount <= 0) {
			return;
		}

		const progressPercent = Math.min(Math.round((currentPage / pagesCount) * 100 * 100) / 100, 99);
		if (progressPercent <= 0) {
			return;
		}

		const ref = extractMangaRef(book.metadata.links, title);
		if (!ref) {
			failures.push({
				itemIndex: idx,
				sourceLabel: title,
				sourceIdentifier: book.id,
				stage: "input_transformation",
				message: "Komga book has no resolvable external identifier",
			});
			return;
		}

		const group = getOrCreateMediaEntityGroup(groupMap, ref, idx);
		group.events.push({
			occurredAt: now,
			eventSchemaSlug: "progress",
			properties: { progressPercent, consumedOn: "komga" },
		});
	});

	return {
		failures,
		entityGroups: finalizeEntityGroups(groupMap),
	} satisfies MediaImportAdapterResult;
});

export const syncKomgaOwnedItems = Effect.fn("komga.syncKomgaOwnedItems")(function* (
	input: KomgaInput,
) {
	const books = yield* fetchAllKomgaBooks(input);
	const ownedItems: Array<{ entityRef: ImportEntityRef; provider: string }> = [];

	for (const book of books) {
		const ref = extractMangaRef(book.metadata.links, book.metadata.title);
		if (ref) {
			ownedItems.push({ provider: "komga", entityRef: ref });
		}
	}

	return ownedItems;
});
