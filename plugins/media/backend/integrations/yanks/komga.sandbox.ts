import { load } from "@ryot-app/plugin-backend-sdk/cheerio";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { readMediaCapture } from "../../imports/collection";
import type { ImportEntityRef, MediaIntegrationAdapterResult } from "../../imports/schemas";
import { MediaSandboxError } from "../../lib/failures";
import { hardcoverGql } from "../../lib/vendors/hardcover";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { baseUrl, executionStartedAt, requestJson } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Komga yank",
	slug: "integration.komga",
});

const Link = Schema.Struct({ url: Schema.String, label: Schema.String });

const Book = Schema.Struct({
	id: Schema.optional(Schema.String),
	media: Schema.optional(Schema.Struct({ pagesCount: Schema.optional(Schema.Finite) })),
	readProgress: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				page: Schema.optional(Schema.Finite),
				completed: Schema.optional(Schema.Boolean),
			}),
		),
	),
	metadata: Schema.optional(
		Schema.Struct({
			title: Schema.optional(Schema.String),
			number: Schema.optional(Schema.String),
			links: Schema.optional(Schema.Array(Link)),
		}),
	),
});

const BooksResponse = Schema.Struct({
	totalPages: Schema.optional(Schema.Finite),
	content: Schema.optional(Schema.Array(Book)),
});
const Cursor = Schema.Struct({
	page: Schema.Int,
	itemIndex: Schema.Int,
	ownership: Schema.Boolean,
	occurredAt: Schema.String,
});
const cursorJson = Schema.fromJsonString(Cursor);

const linkUrl = (value: string) => {
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) ? url : null;
	} catch {
		return null;
	}
};

const positiveId = (value: null | string) =>
	value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
		? String(Number(value))
		: null;

export const mangaRef = (
	links: ReadonlyArray<{ url: string; label: string }>,
	title: string,
): null | ImportEntityRef => {
	for (const { label, url: value } of links) {
		const url = linkUrl(value);
		if (!url) {
			continue;
		}
		const normalized = label.toLowerCase();
		const hostname = url.hostname.replace(/^www\./, "");
		let externalId: null | string = null;
		let providerSlug = "";
		let entitySchemaSlug = "manga";
		if (normalized === "anilist" && hostname === "anilist.co") {
			externalId = positiveId(url.pathname.match(/^\/manga\/(\d+)(?:\/|$)/)?.[1] ?? null);
			providerSlug = "manga.anilist";
		}
		if (["mal", "myanimelist"].includes(normalized) && hostname === "myanimelist.net") {
			externalId = positiveId(url.pathname.match(/^\/manga\/(\d+)(?:\/|$)/)?.[1] ?? null);
			providerSlug = "manga.myanimelist";
		}
		if (normalized === "mangaupdates" && hostname === "mangaupdates.com") {
			const encoded = url.pathname.match(/^\/series\/([a-z0-9]{7})(?:\/|$)/i)?.[1];
			externalId = encoded ? positiveId(String(Number.parseInt(encoded, 36))) : null;
			providerSlug = "manga.manga-updates";
		}
		if (normalized === "hardcover" && hostname === "hardcover.app") {
			externalId = positiveId(url.pathname.match(/^\/books\/(\d+)\/?$/)?.[1] ?? null);
			providerSlug = "book.hardcover";
			entitySchemaSlug = "book";
		}
		if (normalized === "openlibrary" && hostname === "openlibrary.org") {
			externalId = url.pathname.match(/^\/works\/(OL\d+W)(?:\/|$)/)?.[1] ?? null;
			providerSlug = "book.openlibrary";
			entitySchemaSlug = "book";
		}
		if (
			["googlebooks", "google books"].includes(normalized) &&
			/^(?:books\.)?google\.(?:com|co\.[a-z]{2}|[a-z]{2})$/.test(hostname) &&
			url.pathname.startsWith("/books")
		) {
			externalId =
				url.searchParams.get("id") ??
				url.pathname.match(/^\/books\/edition\/[^/]+\/([\w-]+)\/?$/)?.[1] ??
				null;
			if (externalId && !/^[\w-]+$/.test(externalId)) {
				externalId = null;
			}
			providerSlug = "book.google-books";
			entitySchemaSlug = "book";
		}
		if (externalId) {
			return { externalId, providerSlug, kind: "resolved", entitySchemaSlug, sourceLabel: title };
		}
	}
	return null;
};

const hardcoverBooks = Schema.Struct({
	data: Schema.Struct({ books: Schema.Array(Schema.Struct({ id: Schema.Int })) }),
});

const bookRef = Effect.fnUntraced(function* (
	links: ReadonlyArray<typeof Link.Type>,
	title: string,
	host: Pick<ScriptHost, "httpCall" | "getPluginConfig">,
) {
	for (const link of links) {
		const ref = mangaRef([link], title);
		if (ref) {
			return ref;
		}
		const url = linkUrl(link.url);
		const hostname = url?.hostname.replace(/^www\./, "");
		if (
			link.label.toLowerCase() === "mangaupdates" &&
			hostname === "mangaupdates.com" &&
			url?.pathname === "/series.html" &&
			positiveId(url.searchParams.get("id"))
		) {
			const response = yield* host.httpCall(
				"GET",
				`https://www.mangaupdates.com/series.html?id=${url.searchParams.get("id")}`,
			);
			const canonical = load(response.body)('link[rel="canonical"]').attr("href");
			const resolved = canonical
				? mangaRef([{ url: canonical, label: "MangaUpdates" }], title)
				: null;
			if (resolved) {
				return resolved;
			}
		}
		if (link.label.toLowerCase() === "hardcover" && hostname === "hardcover.app") {
			const slug = url?.pathname.match(/^\/books\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/)?.[1];
			if (!slug || /^\d+$/.test(slug)) {
				continue;
			}
			const { hardcoverApiKey } = yield* host.getPluginConfig({ optional: ["hardcoverApiKey"] });
			if (typeof hardcoverApiKey !== "string" || !hardcoverApiKey.trim()) {
				return yield* new MediaSandboxError({ message: "hardcoverApiKey is not configured" });
			}
			const response = yield* hardcoverGql(
				host,
				{
					variables: { slug },
					query:
						"query KomgaHardcoverBook($slug: String!) { books(where: { slug: { _eq: $slug } }) { id } }",
				},
				hardcoverApiKey,
				"Hardcover slug lookup failed",
			).pipe(Effect.flatMap(Schema.decodeUnknownEffect(hardcoverBooks)));
			const id =
				response.data.books.length === 1 ? positiveId(String(response.data.books[0]?.id)) : null;
			if (id) {
				return {
					externalId: id,
					kind: "resolved",
					sourceLabel: title,
					entitySchemaSlug: "book",
					providerSlug: "book.hardcover",
				} satisfies ImportEntityRef;
			}
		}
	}
	return null;
});

export const bookPercentProgress = (page: number, pagesCount: number) => {
	const progressPercent = Math.min(Math.round((page / pagesCount) * 10_000) / 100, 99);
	return progressPercent > 0 ? { progressPercent } : undefined;
};

export const mangaChapterProgress = (input: {
	page: number;
	pagesCount: number;
	chapter: number | undefined;
}) => {
	const { chapter } = input;
	if (chapter === undefined || !Number.isFinite(chapter) || chapter <= 0) {
		return undefined;
	}
	if (input.page >= input.pagesCount) {
		return { mangaChapter: chapter };
	}
	return Number.isInteger(chapter) && chapter > 1 ? { mangaChapter: chapter - 1 } : undefined;
};

export default defineScript({
	manifest,
	input: YankInput,
	output: IntegrationWindowOutput,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			if (input.ingestionConfirmation) {
				return { chunkFiles: [], carryFile: null };
			}
			const startedAt = yield* executionStartedAt(execution);
			const integration = yield* host.getCurrentIntegration();
			const settings = asRecord(integration.providerSpecifics);
			const apiKey = typeof settings?.["apiKey"] === "string" ? settings["apiKey"] : "";
			const url = baseUrl(settings?.["baseUrl"]);
			const headers = {
				"X-API-Key": apiKey,
				Accept: "application/json",
				"Content-Type": "application/json",
			};
			const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
			const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
			const cursor = input.ingestionArtifacts
				? yield* Schema.decodeEffect(cursorJson)(
						new TextDecoder().decode(yield* readMediaCapture("carry")),
					)
				: { page: 0, itemIndex: 0, ownership: false, occurredAt: startedAt };
			const occurredAt = cursor.occurredAt;
			let itemIndex = cursor.itemIndex;
			const response = yield* requestJson(
				host,
				"POST",
				`${url}/api/v1/books/list?page=${cursor.page}&size=500`,
				{
					headers,
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
						cursor.ownership
							? {}
							: { condition: { readStatus: { operator: "is", value: "IN_PROGRESS" } } },
					),
				},
			).pipe(Effect.flatMap(Schema.decodeUnknownEffect(BooksResponse)));
			for (const book of response.content ?? []) {
				const index = itemIndex++;
				const progress = book.readProgress;
				if (
					!cursor.ownership &&
					(!progress || progress.completed || !book.media?.pagesCount || !progress.page)
				) {
					continue;
				}
				const resolution = yield* bookRef(
					book.metadata?.links ?? [],
					book.metadata?.title ?? "",
					host,
				).pipe(
					Effect.match({
						onSuccess: (ref) => ({ ref, failed: false }),
						onFailure: () => ({ ref: null, failed: true }),
					}),
				);
				if (resolution.failed) {
					failures.push({
						itemIndex: index,
						stage: "source_fetch",
						sourceIdentifier: book.id,
						sourceLabel: book.metadata?.title,
						message: "Failed to resolve Komga metadata-provider link",
					});
					continue;
				}
				const ref = resolution.ref;
				if (!ref) {
					if (cursor.ownership) {
						continue;
					}
					failures.push({
						itemIndex: index,
						sourceIdentifier: book.id,
						stage: "input_transformation",
						sourceLabel: book.metadata?.title,
						message: "Komga book has no resolvable external identifier",
					});
					continue;
				}
				if (cursor.ownership) {
					entityGroups.push({
						events: [],
						entityRef: ref,
						itemIndex: index,
						collectionMemberships: [],
						ownershipProvider: "komga",
					});
					continue;
				}
				if (!progress || !book.media?.pagesCount || !progress.page) {
					continue;
				}
				const chapter = book.metadata?.number?.trim();
				const progressProperties =
					ref.entitySchemaSlug === "manga"
						? mangaChapterProgress({
								page: progress.page,
								pagesCount: book.media.pagesCount,
								chapter: chapter && /^\d+(?:\.\d+)?$/.test(chapter) ? Number(chapter) : undefined,
							})
						: bookPercentProgress(progress.page, book.media.pagesCount);
				if (progressProperties === undefined) {
					continue;
				}
				entityGroups.push({
					entityRef: ref,
					itemIndex: index,
					collectionMemberships: [],
					events: [
						{
							occurredAt,
							eventSchemaSlug: "progress",
							properties: { consumedOn: "Komga", ...progressProperties },
							attribution: {
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: book.id ?? String(index),
								recordId: integrationRecordId(["komga", book.id ?? index]),
							},
						},
					],
				});
			}
			let next: null | typeof Cursor.Type = null;
			if (cursor.page + 1 < (response.totalPages ?? 1)) {
				next = { ...cursor, itemIndex, page: cursor.page + 1 };
			} else if (!cursor.ownership && integration.syncOwnership) {
				next = { page: 0, itemIndex, occurredAt, ownership: true };
			}
			return yield* captureIntegrationWindow(
				manifest.slug,
				{ failures, entityGroups },
				next ? yield* Schema.encodeEffect(cursorJson)(next) : null,
			);
		}),
});
