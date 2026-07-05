import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import type { ImportEntityRef } from "../../../imports/schemas";
import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { baseUrl, requestJson, specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Komga yank",
	slug: "integration.komga",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getIntegration"],
});
const Input = Schema.Struct({});
const Link = Schema.Struct({ label: Schema.String, url: Schema.String });
const Book = Schema.Struct({
	id: Schema.optional(Schema.String),
	media: Schema.optional(Schema.Struct({ pagesCount: Schema.optional(Schema.Number) })),
	metadata: Schema.optional(
		Schema.Struct({
			title: Schema.optional(Schema.String),
			links: Schema.optional(Schema.Array(Link)),
		}),
	),
	readProgress: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				page: Schema.optional(Schema.Number),
				completed: Schema.optional(Schema.Boolean),
			}),
		),
	),
});
const BooksResponse = Schema.Struct({
	content: Schema.optional(Schema.Array(Book)),
	totalPages: Schema.optional(Schema.Number),
});
const mangaRef = (
	links: ReadonlyArray<{ label: string; url: string }>,
	title: string,
): ImportEntityRef | null => {
	for (const { label, url } of links) {
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
				kind: "resolved",
				sourceLabel: title,
				externalId: match[1],
				entitySchemaSlug: "manga",
				providerSlug,
			};
		}
	}
	return null;
};
export { mangaRef as extractMangaRef };
export default defineScript({
	manifest,
	input: Input,
	output: MediaIntegrationAdapterResult,
	run: (_input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getIntegration();
			const settings = specifics(integration.providerSpecifics);
			const apiKey = typeof settings?.["apiKey"] === "string" ? settings["apiKey"] : "";
			const url = baseUrl(settings?.["baseUrl"]);
			const headers = { Accept: "application/json", Authorization: `Basic ${btoa(`${apiKey}:`)}` };
			const failures: Array<MediaIntegrationAdapterResult["failures"][number]> = [];
			const entityGroups: Array<MediaIntegrationAdapterResult["entityGroups"][number]> = [];
			let page = 0;
			let pages = 1;
			let itemIndex = 0;
			while (page < pages) {
				const response = yield* requestJson(
					host,
					"GET",
					`${url}/api/v1/books?page=${page}&size=500&read_status=IN_PROGRESS`,
					{ headers },
				).pipe(Effect.flatMap(Schema.decodeUnknown(BooksResponse)));
				pages = response.totalPages ?? 1;
				for (const book of response.content ?? []) {
					const index = itemIndex++;
					const progress = book.readProgress;
					if (!progress || progress.completed || !book.media?.pagesCount || !progress.page) {
						continue;
					}
					const ref = mangaRef(book.metadata?.links ?? [], book.metadata?.title ?? "");
					if (!ref) {
						failures.push({
							itemIndex: index,
							stage: "input_transformation",
							message: "Komga book has no resolvable external identifier",
							sourceLabel: book.metadata?.title,
							sourceIdentifier: book.id,
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
								occurredAt: new Date().toISOString(),
								eventSchemaSlug: "progress",
								properties: { progressPercent: percent, consumedOn: "komga" },
							},
						],
					});
				}
				page += 1;
			}
			if (integration.syncOwnership) {
				let ownershipPage = 0;
				let ownershipPages = 1;
				while (ownershipPage < ownershipPages) {
					const response = yield* requestJson(
						host,
						"GET",
						`${url}/api/v1/books?page=${ownershipPage}&size=500`,
						{ headers },
					).pipe(Effect.flatMap(Schema.decodeUnknown(BooksResponse)));
					ownershipPages = response.totalPages ?? 1;
					for (const book of response.content ?? []) {
						const ref = mangaRef(book.metadata?.links ?? [], book.metadata?.title ?? "");
						if (ref) {
							entityGroups.push({
								entityRef: ref,
								events: [],
								collectionMemberships: [],
								ownershipProvider: "komga",
								itemIndex: entityGroups.length,
							});
						}
					}
					ownershipPage += 1;
				}
			}
			return { failures, entityGroups };
		}),
});
