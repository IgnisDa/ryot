import { dayjs } from "@ryot/ts-utils/dayjs";
import { z } from "zod";

import type { ImportEntityRef, ImportMediaEntityGroup } from "~/modules/imports/jobs";
import { finalizeEntityGroups } from "~/modules/imports/media/book/shared";
import { getOrCreateMediaEntityGroup } from "~/modules/imports/media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "~/modules/imports/media/import-processor";
import {
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "~/modules/imports/runtime/source-api";

const KOMGA_CONCURRENCY = 5;
const KOMGA_PAGE_SIZE = 500;

const komgaLinkSchema = z.object({
	url: z.string(),
	label: z.string(),
});

const komgaMetadataSchema = z.object({
	title: z.string(),
	links: z.array(komgaLinkSchema).optional().default([]),
});

const komgaReadProgressSchema = z
	.object({
		page: z.number().int().optional(),
		completed: z.boolean().optional(),
	})
	.optional()
	.nullable();

const komgaMediaSchema = z.object({
	pagesCount: z.number().int().optional(),
});

const komgaBookSchema = z.object({
	id: z.string(),
	metadata: komgaMetadataSchema,
	media: komgaMediaSchema.optional(),
	readProgress: komgaReadProgressSchema,
});

const komgaBooksPageSchema = z.object({
	totalPages: z.number().int().optional(),
	content: z.array(komgaBookSchema),
	totalElements: z.number().int().optional(),
});

type KomgaInput = {
	apiKey: string;
	baseUrl: string;
};

type KomgaAdapterDeps = {
	mapWithConcurrency: typeof mapWithConcurrency;
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
};

const defaultDeps: KomgaAdapterDeps = {
	mapWithConcurrency,
	requestJson: requestSourceJson,
};

const buildHeaders = (apiKey: string): Record<string, string> => ({
	Accept: "application/json",
	Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
});

type ExternalIdResult = { ref: ImportEntityRef } | null;

const extractExternalRef = (
	links: z.infer<typeof komgaLinkSchema>[],
	title: string,
): ExternalIdResult => {
	for (const link of links) {
		const label = link.label.toLowerCase();
		const url = link.url;

		if (label === "anilist") {
			const match = url.match(/anilist\.co\/manga\/(\d+)/);
			if (match?.[1]) {
				return {
					ref: {
						sourceLabel: title,
						kind: "unresolved",
						identifierValue: match[1],
						entitySchemaSlug: "manga",
						identifierType: "anilist_id",
					},
				};
			}
		}

		if (label === "myanimelist" || label === "mal") {
			const match = url.match(/myanimelist\.net\/manga\/(\d+)/);
			if (match?.[1]) {
				return {
					ref: {
						kind: "unresolved",
						sourceLabel: title,
						identifierType: "mal_id",
						identifierValue: match[1],
						entitySchemaSlug: "manga",
					},
				};
			}
		}

		if (label === "mangaupdates") {
			const match = url.match(/mangaupdates\.com\/series\/([^/]+)/);
			if (match?.[1]) {
				return {
					ref: {
						sourceLabel: title,
						kind: "unresolved",
						identifierValue: match[1],
						entitySchemaSlug: "manga",
						identifierType: "mangaupdates_id",
					},
				};
			}
		}

		if (label === "hardcover") {
			const match = url.match(/hardcover\.app\/books\/([^/?#]+)/);
			if (match?.[1]) {
				return {
					ref: {
						sourceLabel: title,
						kind: "unresolved",
						identifierValue: match[1],
						entitySchemaSlug: "manga",
						identifierType: "hardcover_id",
					},
				};
			}
		}

		if (label === "openlibrary") {
			const match = url.match(/openlibrary\.org\/works\/(OL\w+)/);
			if (match?.[1]) {
				return {
					ref: {
						sourceLabel: title,
						kind: "unresolved",
						identifierValue: match[1],
						entitySchemaSlug: "manga",
						identifierType: "openlibrary_id",
					},
				};
			}
		}

		if (label === "google books" || label === "google") {
			const match = url.match(/books\.google\.com\/books\?id=([^&]+)/);
			if (match?.[1]) {
				return {
					ref: {
						sourceLabel: title,
						kind: "unresolved",
						identifierValue: match[1],
						entitySchemaSlug: "manga",
						identifierType: "google_book_id",
					},
				};
			}
		}
	}

	return null;
};

const fetchAllKomgaBooks = async (
	input: KomgaInput,
	deps: KomgaAdapterDeps,
	readStatus?: string,
): Promise<z.infer<typeof komgaBookSchema>[]> => {
	const baseUrl = input.baseUrl.replace(/\/$/, "");
	const headers = buildHeaders(input.apiKey);
	const books: z.infer<typeof komgaBookSchema>[] = [];
	let page = 0;
	let totalPages = 1;

	while (page < totalPages) {
		// oxlint-disable-next-line no-await-in-loop
		const resp = komgaBooksPageSchema.parse(
			// oxlint-disable-next-line no-await-in-loop
			await deps.requestJson({
				headers,
				baseUrl,
				sourceName: "Komga",
				path: "api/v1/books",
				query: { page, size: KOMGA_PAGE_SIZE, ...(readStatus ? { read_status: readStatus } : {}) },
			}),
		);
		books.push(...resp.content);
		totalPages = resp.totalPages ?? 1;
		page += 1;
	}

	return books;
};

export const fetchKomgaProgress = async (
	input: KomgaInput,
	deps: KomgaAdapterDeps = defaultDeps,
): Promise<MediaImportAdapterResult> => {
	const now = dayjs().toISOString();
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ImportMediaEntityGroup>();

	const books = await fetchAllKomgaBooks(input, deps, "IN_PROGRESS");

	// oxlint-disable-next-line require-await
	await deps.mapWithConcurrency(books, KOMGA_CONCURRENCY, async (book, idx) => {
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

		const externalResult = extractExternalRef(book.metadata.links, title);
		if (!externalResult) {
			failures.push({
				itemIndex: idx,
				sourceLabel: title,
				sourceIdentifier: book.id,
				stage: "input_transformation",
				message: "Komga book has no resolvable external identifier",
			});
			return;
		}

		const group = getOrCreateMediaEntityGroup(groupMap, externalResult.ref, idx);
		group.events.push({
			occurredAt: now,
			eventSchemaSlug: "progress",
			properties: { progressPercent, consumedOn: "komga" },
		});
	});

	return { failures, entityGroups: finalizeEntityGroups(groupMap) };
};

export const syncKomgaOwnedItems = async (
	input: KomgaInput,
	deps: KomgaAdapterDeps = defaultDeps,
): Promise<Array<{ entityRef: ImportEntityRef; provider: string }>> => {
	const books = await fetchAllKomgaBooks(input, deps);
	const ownedItems: Array<{ entityRef: ImportEntityRef; provider: string }> = [];

	for (const book of books) {
		const title = book.metadata.title;
		const externalResult = extractExternalRef(book.metadata.links, title);
		if (externalResult) {
			ownedItems.push({ provider: "komga", entityRef: externalResult.ref });
		}
	}

	return ownedItems;
};
