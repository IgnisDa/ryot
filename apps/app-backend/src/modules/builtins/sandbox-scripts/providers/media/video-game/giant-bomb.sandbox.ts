import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	collectNames,
	combineDescription,
	createRoleAccumulator,
	extractGiantBombGuid,
	extractYear,
	getPrioritizedImage,
	GUID_PATTERN,
	giantBombRequest,
	imageProperty,
	paginate,
	readResults,
	readTotalItems,
	stringValue,
} from "../../giant-bomb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb",
	slug: "video-game.giant-bomb",
	providerInformation: { source: "giant-bomb" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["providers.giantBombApiKey"],
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
			query: input.query,
			resources: "game",
			limit: String(input.pageSize),
			offset: String((input.page - 1) * input.pageSize),
		},
		"GiantBomb search request failed",
	).then((payload) => {
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
					calloutProperty: { kind: "null" as const, value: null },
					titleProperty: { kind: "text" as const, value: name },
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
		throw new Error("externalId must be a GiantBomb GUID (e.g., '3030-1')");
	}
	return giantBombRequest(
		host,
		`game/${encodeURIComponent(input.externalId)}/`,
		{ field_list: FIELD_LIST },
		"GiantBomb details request failed",
	).then((payload) => {
		const game = asRecord(payload?.["results"]);
		if (!game) {
			throw new Error("GiantBomb returned no game data");
		}
		const name = stringValue(game["name"]);
		if (!name) {
			throw new Error("GiantBomb game payload is missing name");
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
					synchronization: "additive" as const,
					entities: groupAccumulator.entities,
					relationshipSchemaSlug: "video-game-group-to-video-game",
				},
				{
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "media-suggestion",
					entities: [...suggestionByKey.values()],
				},
			],
			properties: {
				genres: [...collectNames(game["genres"]), ...collectNames(game["themes"])],
				images: primaryImage ? [{ type: "remote" as const, url: primaryImage }] : [],
				platformReleases: buildPlatformReleases(game["platforms"]),
				publishYear: extractYear(game["original_release_date"]),
				description: combineDescription(game["deck"], game["description"]),
				sourceUrl: stringValue(game["site_detail_url"]),
			},
		};
	});
});

export default defineProvider({ manifest, drivers: { search, details } });
