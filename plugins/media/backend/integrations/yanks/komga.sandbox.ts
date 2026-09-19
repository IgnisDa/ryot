import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { readMediaCapture } from "../../imports/collection";
import type { ImportEntityRef, MediaIntegrationAdapterResult } from "../../imports/schemas";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { baseUrl, executionStartedAt, requestJson, specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Komga yank",
	slug: "integration.komga",
	capabilities: ["httpCall", "getCurrentIntegration", "scratch", "artifact-read"],
});

const Link = Schema.Struct({ url: Schema.String, label: Schema.String });

const Book = Schema.Struct({
	id: Schema.optional(Schema.String),
	media: Schema.optional(Schema.Struct({ pagesCount: Schema.optional(Schema.Finite) })),
	metadata: Schema.optional(
		Schema.Struct({
			title: Schema.optional(Schema.String),
			links: Schema.optional(Schema.Array(Link)),
		}),
	),
	readProgress: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				page: Schema.optional(Schema.Finite),
				completed: Schema.optional(Schema.Boolean),
			}),
		),
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

export const mangaRef = (
	links: ReadonlyArray<{ label: string; url: string }>,
	title: string,
): ImportEntityRef | null => {
	for (const { url, label } of links) {
		const normalized = label.toLowerCase();
		let match: RegExpMatchArray | null = null;
		let providerSlug = "manga.manga-updates";
		if (normalized === "anilist") {
			match = url.match(/anilist\.co\/manga\/(\d+)/);
			providerSlug = "manga.anilist";
		}
		if (["myanimelist", "mal"].includes(normalized)) {
			match = url.match(/myanimelist\.net\/manga\/(\d+)/);
			providerSlug = "manga.myanimelist";
		}
		if (normalized === "mangaupdates") {
			match = url.match(/mangaupdates\.com\/series\/([^/]+)/);
		}
		if (match?.[1]) {
			return {
				providerSlug,
				kind: "resolved",
				sourceLabel: title,
				externalId: match[1],
				entitySchemaSlug: "manga",
			};
		}
	}
	return null;
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
			const settings = specifics(integration.providerSpecifics);
			const apiKey = typeof settings?.["apiKey"] === "string" ? settings["apiKey"] : "";
			const url = baseUrl(settings?.["baseUrl"]);
			const headers = { Accept: "application/json", Authorization: `Basic ${btoa(`${apiKey}:`)}` };
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
				"GET",
				`${url}/api/v1/books?page=${cursor.page}&size=500${cursor.ownership ? "" : "&read_status=IN_PROGRESS"}`,
				{ headers },
			).pipe(Effect.flatMap(Schema.decodeUnknownEffect(BooksResponse)));
			for (const book of response.content ?? []) {
				const index = itemIndex++;
				if (cursor.ownership) {
					const ref = mangaRef(book.metadata?.links ?? [], book.metadata?.title ?? "");
					if (ref) {
						entityGroups.push({
							events: [],
							entityRef: ref,
							itemIndex: index,
							collectionMemberships: [],
							ownershipProvider: "komga",
						});
					}
					continue;
				}
				const progress = book.readProgress;
				if (!progress || progress.completed || !book.media?.pagesCount || !progress.page) {
					continue;
				}
				const ref = mangaRef(book.metadata?.links ?? [], book.metadata?.title ?? "");
				if (!ref) {
					failures.push({
						itemIndex: index,
						sourceIdentifier: book.id,
						stage: "input_transformation",
						sourceLabel: book.metadata?.title,
						message: "Komga book has no resolvable external identifier",
					});
					continue;
				}
				const percent = Math.min(
					Math.round((progress.page / book.media.pagesCount) * 10_000) / 100,
					99,
				);
				if (percent <= 0) {
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
							properties: { consumedOn: "komga", progressPercent: percent },
							attribution: {
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: book.id ?? String(index),
								recordId: integrationRecordId(["komga", book.id ?? index]),
							},
						},
					],
				});
			}
			let next: typeof Cursor.Type | null = null;
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
