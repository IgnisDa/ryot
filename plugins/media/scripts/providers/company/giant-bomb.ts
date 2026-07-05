import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../script-helpers/records";
import { createRoleAccumulator } from "../../script-helpers/role-accumulator";
import {
	combineDescription,
	extractYear,
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
	slug: "company.giant-bomb",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["videoGames.giantBombApiKey"],
});

const getGameGuid = (game: Record<string, unknown> | null) => {
	const guid = stringValue(game?.["guid"]);
	if (guid && GUID_PATTERN.test(guid)) {
		return guid;
	}
	const apiDetailUrl = game?.["api_detail_url"];
	if (typeof apiDetailUrl !== "string") {
		return null;
	}
	let lastGuid: string | null = null;
	for (const part of apiDetailUrl.split("/")) {
		if (GUID_PATTERN.test(part)) {
			lastGuid = part;
		}
	}
	return lastGuid;
};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		giantBombRequest(
			host,
			"search/",
			{
				query: input.query,
				resources: "company",
				limit: String(input.pageSize),
				offset: String((input.page - 1) * input.pageSize),
			},
			"GiantBomb company search request failed",
		).pipe(
			Effect.map((payload) => {
				const items = readResults(payload).flatMap((company) => {
					const record = asRecord(company);
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
});

const FIELD_LIST = [
	"id",
	"guid",
	"name",
	"deck",
	"description",
	"date_founded",
	"location_city",
	"location_state",
	"location_country",
	"website",
	"image",
	"site_detail_url",
	"aliases",
	"developed_games.guid",
	"developed_games.name",
	"developed_games.api_detail_url",
	"published_games.guid",
	"published_games.name",
	"published_games.api_detail_url",
].join(",");

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!GUID_PATTERN.test(input.externalId)) {
			throw new Error("externalId must be a GiantBomb GUID (e.g., '4010-1')");
		}
		return giantBombRequest(
			host,
			`company/${encodeURIComponent(input.externalId)}/`,
			{ field_list: FIELD_LIST },
			"GiantBomb company details request failed",
		).pipe(
			Effect.map((payload) => {
				const company = asRecord(payload?.["results"]);
				if (!company) {
					throw new Error("GiantBomb returned no company data");
				}
				const name = stringValue(company["name"]);
				if (!name) {
					throw new Error("GiantBomb company payload is missing name");
				}

				const primaryImage = getPrioritizedImage(company["image"]);
				const locationParts = [
					stringValue(company["location_city"]),
					stringValue(company["location_state"]),
					stringValue(company["location_country"]),
				].filter((part) => part !== null);
				const headquarters = locationParts.length > 0 ? locationParts.join(", ") : null;

				const aliases = company["aliases"];
				const alternateNames =
					typeof aliases === "string" && aliases.trim()
						? aliases
								.split("\n")
								.map((alias) => alias.trim())
								.filter((alias) => alias.length > 0)
						: [];

				const accumulator = createRoleAccumulator();
				const addGames = (games: unknown, role: string) => {
					for (const game of Array.isArray(games) ? games : []) {
						const record = asRecord(game);
						const externalId = getGameGuid(record);
						const gameName = stringValue(record?.["name"]);
						if (!externalId || !gameName) {
							continue;
						}
						accumulator.add({
							externalId,
							name: gameName,
							providerSlug: "video-game.giant-bomb",
							relationshipProperties: { roles: [role] },
						});
					}
				};
				addGames(company["developed_games"], "Developer");
				addGames(company["published_games"], "Publisher");

				return {
					name,
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							entities: accumulator.entities,
							relationshipSchemaSlug: "company-to-video-game",
						},
					],
					properties: {
						headquarters,
						alternateNames,
						foundedYear: extractYear(company["date_founded"]),
						website: stringValue(company["website"]),
						sourceUrl: stringValue(company["site_detail_url"]),
						images: primaryImage ? [{ type: "remote" as const, url: primaryImage }] : [],
						description: combineDescription(company["deck"], company["description"]),
					},
				};
			}),
		);
	},
});
