import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../../lib/records";
import {
	combineDescription,
	extractGiantBombGuid,
	getPrioritizedImage,
	GUID_PATTERN,
	giantBombRequest,
	paginate,
	readResults,
	readTotalItems,
} from "../../../lib/vendors/giant-bomb";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb",
	requiredSystemConfigKeys: [],
	slug: "video-game-group.giant-bomb",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["giantBombApiKey"],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		giantBombRequest(
			host,
			"search/",
			{
				query: input.query,
				resources: "franchise",
				limit: String(input.pageSize),
				offset: String((input.page - 1) * input.pageSize),
			},
			"GiantBomb search request failed",
		).pipe(
			Effect.map((payload) => {
				const items = readResults(payload).flatMap((franchise) => {
					const record = asRecord(franchise);
					const externalId = stringValue(record?.["guid"]);
					const name = stringValue(record?.["name"]);
					if (!externalId || !name) {
						return [];
					}
					const image = getPrioritizedImage(record?.["image"]);
					return [{ externalId, title: name, ...(image === null ? {} : { imageUrl: image }) }];
				});
				return { items, details: paginate(input.page, input.pageSize, readTotalItems(payload)) };
			}),
		),
});

const FIELD_LIST = [
	"id",
	"guid",
	"name",
	"deck",
	"description",
	"image",
	"games",
	"site_detail_url",
].join(",");

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!GUID_PATTERN.test(input.externalId)) {
				return yield* Effect.fail(
					new Error("externalId must be a GiantBomb GUID (e.g., '3030-1')"),
				);
			}
			const payload = yield* giantBombRequest(
				host,
				`franchise/${encodeURIComponent(input.externalId)}/`,
				{ field_list: FIELD_LIST },
				"GiantBomb details request failed",
			);
			const franchise = asRecord(payload?.["results"]);
			if (!franchise) {
				return yield* Effect.fail(new Error("GiantBomb returned no franchise data"));
			}
			const name = stringValue(franchise["name"]);
			if (!name) {
				return yield* Effect.fail(new Error("GiantBomb franchise payload is missing name"));
			}

			const primaryImage = getPrioritizedImage(franchise["image"]);
			const franchiseGames = Array.isArray(franchise["games"]) ? franchise["games"] : [];
			const relatedEntities = franchiseGames.flatMap((game, index) => {
				const record = asRecord(game);
				const memberId = extractGiantBombGuid(record?.["api_detail_url"]);
				if (!memberId) {
					return [];
				}
				return [
					{
						externalId: memberId,
						providerSlug: "video-game.giant-bomb",
						relationshipProperties: { order: index + 1 },
						name: stringValue(record?.["name"]) ?? "Loading...",
					},
				];
			});

			return {
				name,
				relatedEntityGroups: [
					{
						entities: relatedEntities,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "video-game-group-to-video-game",
					},
				],
				properties: {
					parts: franchiseGames.length,
					sourceUrl: stringValue(franchise["site_detail_url"]),
					description: combineDescription(franchise["deck"], franchise["description"]),
					images: primaryImage
						? [{ url: primaryImage, type: "remote" as const, purpose: "cover" as const }]
						: [],
				},
			};
		}),
});
