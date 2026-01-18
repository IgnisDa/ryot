import { defineManifest } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../script-helpers/records";
import {
	combineDescription,
	extractGiantBombGuid,
	getPrioritizedImage,
	GUID_PATTERN,
	giantBombRequest,
	imageProperty,
	paginate,
	readResults,
	readTotalItems,
} from "../giant-bomb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb",
	slug: "video-game-group.giant-bomb",
	providerInformation: { source: "giant-bomb" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["videoGames.giantBombApiKey"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
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
				return [
					{
						externalId,
						calloutProperty: { kind: "null" as const, value: null },
						titleProperty: { kind: "text" as const, value: name },
						primarySubtitleProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty: imageProperty(getPrioritizedImage(record?.["image"])),
					},
				];
			});
			return { items, details: paginate(input.page, input.pageSize, readTotalItems(payload)) };
		}),
	),
);

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

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	Effect.gen(function* () {
		if (!GUID_PATTERN.test(input.externalId)) {
			return yield* Effect.fail(new Error("externalId must be a GiantBomb GUID (e.g., '3030-1')"));
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
					scriptSlug: "video-game.giant-bomb",
					relationshipProperties: { order: index + 1 },
					name: stringValue(record?.["name"]) ?? "Loading...",
				},
			];
		});

		return {
			name,
			relatedEntityGroups: [
				{
					direction: "outgoing" as const,
					entities: relatedEntities,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "video-game-group-to-video-game",
				},
			],
			properties: {
				parts: franchiseGames.length,
				sourceUrl: stringValue(franchise["site_detail_url"]),
				images: primaryImage ? [{ type: "remote" as const, url: primaryImage }] : [],
				description: combineDescription(franchise["deck"], franchise["description"]),
			},
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
