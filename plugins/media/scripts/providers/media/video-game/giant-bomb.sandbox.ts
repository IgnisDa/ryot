import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../../script-helpers/records";
import { createRoleAccumulator } from "../../../script-helpers/role-accumulator";
import {
	collectNames,
	combineDescription,
	extractGiantBombGuid,
	extractYear,
	getPrioritizedImage,
	GUID_PATTERN,
	giantBombRequest,
	imageProperty,
	paginate,
	readResults,
	readTotalItems,
} from "../../giant-bomb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb",
	slug: "video-game.giant-bomb",
	providerInformation: { source: "giant-bomb" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["videoGames.giantBombApiKey"],
});

const buildPlatformReleases = (platforms: unknown) => {
	if (!Array.isArray(platforms) || platforms.length === 0) {
		return null;
	}
	const releases = platforms.flatMap((platform) => {
		const name = stringValue(asRecord(platform)?.["name"]);
		return name ? [{ name }] : [];
	});
	return releases.length > 0 ? releases : null;
};

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	giantBombRequest(
		host,
		"search/",
		{
			resources: "game",
			query: input.query,
			limit: String(input.pageSize),
			offset: String((input.page - 1) * input.pageSize),
		},
		"GiantBomb search request failed",
	).pipe(
		Effect.map((payload) => {
			const items = readResults(payload).flatMap((game) => {
				const record = asRecord(game);
				const externalId = stringValue(record?.["guid"]);
				const name = stringValue(record?.["name"]);
				if (!externalId || !name) {
					return [];
				}
				const publishYear = extractYear(record?.["original_release_date"]);
				return [
					{
						externalId,
						titleProperty: { kind: "text" as const, value: name },
						calloutProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty: imageProperty(getPrioritizedImage(record?.["image"])),
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
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
	"image",
	"genres",
	"themes",
	"platforms",
	"developers",
	"publishers",
	"description",
	"site_detail_url",
	"franchises.name",
	"similar_games.name",
	"original_release_date",
	"similar_games.api_detail_url",
	"franchises.api_detail_url",
].join(",");

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!GUID_PATTERN.test(input.externalId)) {
		return Effect.fail(new Error("externalId must be a GiantBomb GUID (e.g., '3030-1')"));
	}
	return Effect.gen(function* () {
		const payload = yield* giantBombRequest(
			host,
			`game/${encodeURIComponent(input.externalId)}/`,
			{ field_list: FIELD_LIST },
			"GiantBomb details request failed",
		);
		const game = asRecord(payload?.["results"]);
		if (!game) {
			return yield* Effect.fail(new Error("GiantBomb returned no game data"));
		}
		const name = stringValue(game["name"]);
		if (!name) {
			return yield* Effect.fail(new Error("GiantBomb game payload is missing name"));
		}

		const companyAccumulator = createRoleAccumulator();
		const addCompanies = (items: unknown, role: string) => {
			if (!Array.isArray(items)) {
				return;
			}
			for (const item of items) {
				const record = asRecord(item);
				const guid = stringValue(record?.["guid"]);
				if (!guid) {
					continue;
				}
				companyAccumulator.add({
					externalId: guid,
					scriptSlug: "company.giant-bomb",
					relationshipProperties: { roles: [role] },
					name: stringValue(record?.["name"]) ?? "Loading...",
				});
			}
		};
		addCompanies(game["developers"], "Developer");
		addCompanies(game["publishers"], "Publisher");

		const groupAccumulator = createRoleAccumulator();
		for (const franchise of Array.isArray(game["franchises"]) ? game["franchises"] : []) {
			const record = asRecord(franchise);
			const externalId = extractGiantBombGuid(record?.["api_detail_url"]);
			if (!externalId) {
				continue;
			}
			groupAccumulator.add({
				externalId,
				scriptSlug: "video-game-group.giant-bomb",
				relationshipProperties: { roles: ["Member"] },
				name: stringValue(record?.["name"]) ?? "Loading...",
			});
		}

		const suggestionByKey = new Map<
			string,
			{ name: string; externalId: string; scriptSlug: string }
		>();
		for (const similar of Array.isArray(game["similar_games"]) ? game["similar_games"] : []) {
			const record = asRecord(similar);
			const externalId = extractGiantBombGuid(record?.["api_detail_url"]);
			if (!externalId) {
				continue;
			}
			suggestionByKey.set(`video-game.giant-bomb:${externalId}`, {
				externalId,
				scriptSlug: "video-game.giant-bomb",
				name: stringValue(record?.["name"]) ?? "Loading...",
			});
		}

		const primaryImage = getPrioritizedImage(game["image"]);

		return {
			name,
			relatedEntityGroups: [
				{
					direction: "incoming" as const,
					synchronization: "additive" as const,
					entities: companyAccumulator.entities,
					relationshipSchemaSlug: "company-to-video-game",
				},
				{
					direction: "incoming" as const,
					entities: groupAccumulator.entities,
					synchronization: "additive" as const,
					relationshipSchemaSlug: "video-game-group-to-video-game",
				},
				{
					direction: "outgoing" as const,
					entities: [...suggestionByKey.values()],
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "media-suggestion",
				},
			],
			properties: {
				sourceUrl: stringValue(game["site_detail_url"]),
				publishYear: extractYear(game["original_release_date"]),
				platformReleases: buildPlatformReleases(game["platforms"]),
				images: primaryImage ? [{ type: "remote" as const, url: primaryImage }] : [],
				description: combineDescription(game["deck"], game["description"]),
				genres: [...collectNames(game["genres"]), ...collectNames(game["themes"])],
			},
		};
	});
});

export default defineProvider({ manifest, drivers: { search, details } });
