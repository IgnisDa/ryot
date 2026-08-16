import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../../../shared/records";
import { type RoleRelatedEntity, createRoleAccumulator } from "../../../../shared/role-accumulator";
import {
	buildIgdbImageUrl,
	buildPagination,
	makeIgdbRequest,
	readTotalItems,
	type IgdbHost,
	toSlug,
} from "../../igdb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB",
	slug: "video-game.igdb",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});
const IMAGE_BASE_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";
const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });
const stringArray = Schema.Array(Schema.String);
const igdbSearchOptionsSchema = strictStruct({
	themeIds: Schema.optional(stringArray),
	genreIds: Schema.optional(stringArray),
	platformIds: Schema.optional(stringArray),
	gameModeIds: Schema.optional(stringArray),
	gameTypeIds: Schema.optional(stringArray),
	releaseDateRegionIds: Schema.optional(stringArray),
	allowGamesWithParent: Schema.optional(Schema.Boolean),
});
const getImageUrl = (imageId: string) => buildIgdbImageUrl(IMAGE_BASE_URL, imageId);
const extractYear = (unixTimestamp: unknown) => {
	const value = numberValue(unixTimestamp);
	if (value === null) {
		return null;
	}
	return DateTime.toDateUtc(DateTime.makeUnsafe(value * 1000)).getFullYear();
};
const unixToIsoDate = (unixTimestamp: unknown) => {
	const value = numberValue(unixTimestamp);
	if (value === null) {
		return null;
	}
	const parsed = DateTime.make(value * 1000);
	if (Option.isNone(parsed)) {
		return null;
	}
	return DateTime.formatIsoDateUtc(parsed.value);
};
const secondsToMinutes = (seconds: unknown) => {
	const value = numberValue(seconds);
	return value === null || value <= 0 ? null : Math.round(value / 60);
};
const buildPlatformReleases = (releaseDates: unknown) => {
	if (!Array.isArray(releaseDates) || releaseDates.length === 0) {
		return null;
	}
	const releases = releaseDates.flatMap((rd) => {
		const record = asRecord(rd);
		if (!record) {
			return [];
		}
		const platformName = stringValue(asRecord(record["platform"])?.["name"]);
		if (!platformName) {
			return [];
		}
		const releaseDate = unixToIsoDate(record["date"]);
		const releaseRegion = stringValue(asRecord(record["release_region"])?.["region"]);
		return [{ name: platformName, releaseDate, releaseRegion }];
	});
	if (releases.length === 0) {
		return null;
	}
	releases.sort((a, b) => a.name.localeCompare(b.name));
	return releases;
};
const collectCompanies = (involvedCompanies: unknown) => {
	const accumulator = createRoleAccumulator();
	for (const ic of Array.isArray(involvedCompanies) ? involvedCompanies : []) {
		const record = asRecord(ic);
		const company = asRecord(record?.["company"]);
		if (!company) {
			continue;
		}
		const id = numberValue(company["id"]);
		if (id === null) {
			continue;
		}
		const name = stringValue(company["name"]) ?? "Loading...";
		let role = "Developer";
		if (record?.["developer"]) {
			role = "Developer";
		} else if (record?.["publisher"]) {
			role = "Publisher";
		} else if (record?.["porting"]) {
			role = "Porting";
		} else if (record?.["supporting"]) {
			role = "Supporting";
		}
		accumulator.add({
			name,
			externalId: String(Math.trunc(id)),
			providerSlug: "company.igdb",
			relationshipProperties: { roles: [role] },
		});
	}
	return accumulator.entities;
};
const collectGroups = (collections: unknown) => {
	const groupByKey = new Map<string, RoleRelatedEntity>();
	for (const collection of Array.isArray(collections) ? collections : []) {
		const id = numberValue(asRecord(collection)?.["id"]);
		if (id === null) {
			continue;
		}
		const externalId = String(Math.trunc(id));
		const key = `video-game-group.igdb:${externalId}`;
		if (groupByKey.has(key)) {
			continue;
		}
		groupByKey.set(key, {
			externalId,
			name: "Loading...",
			providerSlug: "video-game-group.igdb",
			relationshipProperties: { roles: ["Member"] },
		});
	}
	return [...groupByKey.values()];
};
const collectSuggestions = (similarGames: unknown) =>
	(Array.isArray(similarGames) ? similarGames : []).flatMap((game) => {
		const record = asRecord(game);
		const id = numberValue(record?.["id"]);
		const name = stringValue(record?.["name"]);
		if (id === null || !name) {
			return [];
		}
		return [{ name, externalId: String(Math.trunc(id)), providerSlug: "video-game.igdb" }];
	});
const SEARCH_FIELDS = "id, name, cover.image_id, first_release_date";
const DETAIL_FIELDS = [
	"id",
	"slug",
	"name",
	"rating",
	"summary",
	"genres.name",
	"cover.image_id",
	"collections.id",
	"artworks.image_id",
	"first_release_date",
	"release_dates.date",
	"involved_companies.porting",
	"release_dates.platform.name",
	"involved_companies.developer",
	"involved_companies.publisher",
	"involved_companies.company.id",
	"involved_companies.supporting",
	"involved_companies.company.name",
	"release_dates.release_region.region",
	"similar_games.id",
	"similar_games.name",
].join(", ");
const IGDB_OPTIONS_PAGE_SIZE = 500;
const searchOptionSources = {
	themes: { fields: "id,name", labelField: "name", path: "themes" },
	genres: { fields: "id,name", labelField: "name", path: "genres" },
	platforms: { fields: "id,name", labelField: "name", path: "platforms" },
	gameModes: { fields: "id,name", labelField: "name", path: "game_modes" },
	gameTypes: { fields: "id,type", labelField: "type", path: "game_types" },
	releaseDateRegions: { fields: "id,region", labelField: "region", path: "release_date_regions" },
} as const;
const loadSearchOptions = (
	host: IgdbHost,
	source: (typeof searchOptionSources)[keyof typeof searchOptionSources],
) =>
	Effect.gen(function* () {
		const optionsByValue = new Map<string, { value: string; label: string }>();
		let offset = 0;
		let hasNextPage = true;
		while (hasNextPage) {
			const body = [
				`fields ${source.fields};`,
				"sort id asc;",
				`limit ${IGDB_OPTIONS_PAGE_SIZE};`,
				`offset ${offset};`,
			].join("\n");
			const { data } = yield* makeIgdbRequest(host, source.path, body);
			if (!Array.isArray(data)) {
				return yield* Effect.fail(
					new Error(`IGDB ${source.path} returned unexpected response format`),
				);
			}
			for (const item of data) {
				const record = asRecord(item);
				const id = numberValue(record?.["id"]);
				const label = stringValue(record?.[source.labelField]);
				if (id === null || !Number.isInteger(id) || !label) {
					continue;
				}
				const value = String(id);
				if (!optionsByValue.has(value)) {
					optionsByValue.set(value, { value, label });
				}
			}
			hasNextPage = data.length === IGDB_OPTIONS_PAGE_SIZE;
			if (hasNextPage) {
				offset += IGDB_OPTIONS_PAGE_SIZE;
			}
		}
		return [...optionsByValue.values()].sort(
			(a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value),
		);
	});
export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		Effect.gen(function* () {
			const options = yield* Schema.decodeUnknownEffect(igdbSearchOptionsSchema)(
				input.options ?? {},
			);
			const conditions = options.allowGamesWithParent ? [] : ["version_parent = null"];
			for (const [ids, field] of [
				[options.themeIds, "themes"],
				[options.genreIds, "genres"],
				[options.platformIds, "platforms"],
				[options.gameModeIds, "game_mode"],
				[options.gameTypeIds, "game_type"],
				[options.releaseDateRegionIds, "release_dates.region"],
			] as const) {
				if (ids && ids.length > 0) {
					conditions.push(`${field} = (${ids.join(",")})`);
				}
			}
			const offset = (input.page - 1) * input.pageSize;
			const body = [
				`fields ${SEARCH_FIELDS};`,
				...(conditions.length > 0 ? [`where ${conditions.join(" & ")};`] : []),
				`search "${input.query}";`,
				`limit ${input.pageSize};`,
				`offset ${offset};`,
			].join("\n");
			return yield* makeIgdbRequest(host, "games", body).pipe(
				Effect.flatMap(({ data: results, headers }) => {
					if (!Array.isArray(results)) {
						return Effect.fail(new Error("IGDB search returned unexpected response format"));
					}
					const totalItems = readTotalItems(headers, results.length, offset);
					const items = results.flatMap((game) => {
						const record = asRecord(game);
						const id = numberValue(record?.["id"]);
						const name = stringValue(record?.["name"]);
						if (id === null || !name) {
							return [];
						}
						const publishYear = extractYear(record?.["first_release_date"]);
						const imageId = stringValue(asRecord(record?.["cover"])?.["image_id"]);
						const image = imageId ? getImageUrl(imageId) : null;
						return [
							{
								title: name,
								externalId: String(id),
								...(image === null ? {} : { imageUrl: image }),
								...(publishYear === null ? {} : { metadata: [publishYear] as const }),
							},
						];
					});
					return Effect.succeed({
						items,
						details: buildPagination(offset, results.length, totalItems, input.page),
					});
				}),
			);
		}),
});

export const searchOptions = defineProvider({
	manifest,
	operation: "search-options",
	run: (_input, host) =>
		Effect.gen(function* () {
			const sources = yield* Effect.all(
				{
					themes: loadSearchOptions(host, searchOptionSources.themes),
					genres: loadSearchOptions(host, searchOptionSources.genres),
					platforms: loadSearchOptions(host, searchOptionSources.platforms),
					gameModes: loadSearchOptions(host, searchOptionSources.gameModes),
					gameTypes: loadSearchOptions(host, searchOptionSources.gameTypes),
					releaseDateRegions: loadSearchOptions(host, searchOptionSources.releaseDateRegions),
				},
				{ concurrency: 1 },
			);
			return { sources };
		}),
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			return Effect.fail(new Error("externalId must be a numeric IGDB game ID (e.g., '1020')"));
		}
		const gameBody = [`fields ${DETAIL_FIELDS};`, `where id = ${input.externalId};`].join("\n");
		const ttbBody = [
			"fields normally, hastily, completely;",
			`where game_id = ${input.externalId};`,
		].join("\n");
		return Effect.all([
			makeIgdbRequest(host, "games", gameBody),
			makeIgdbRequest(host, "game_time_to_beats", ttbBody),
		]).pipe(
			Effect.flatMap(([gameResult, ttbResult]) =>
				Effect.gen(function* () {
					const gameList = gameResult.data;
					if (!Array.isArray(gameList) || gameList.length === 0) {
						return yield* Effect.fail(new Error("IGDB returned no game data for this externalId"));
					}
					const game = asRecord(gameList[0]);
					const name = stringValue(game?.["name"]);
					if (!name) {
						return yield* Effect.fail(new Error("IGDB game payload is missing name"));
					}
					const images: Array<{
						type: "remote";
						url: string;
						purpose: string;
					}> = [];
					const coverImageId = stringValue(asRecord(game?.["cover"])?.["image_id"]);
					if (coverImageId) {
						images.push({
							type: "remote",
							url: getImageUrl(coverImageId),
							purpose: "cover" as const,
						});
					}
					for (const artwork of Array.isArray(game?.["artworks"]) ? game["artworks"] : []) {
						const artworkImageId = stringValue(asRecord(artwork)?.["image_id"]);
						if (artworkImageId) {
							images.push({
								type: "remote",
								url: getImageUrl(artworkImageId),
								purpose: "artwork" as const,
							});
						}
					}
					const genres = (Array.isArray(game?.["genres"]) ? game["genres"] : []).flatMap((g) => {
						const genreName = stringValue(asRecord(g)?.["name"]);
						return genreName ? [genreName] : [];
					});
					const ttbList = ttbResult.data;
					const ttbEntry =
						Array.isArray(ttbList) && ttbList.length > 0 ? asRecord(ttbList[0]) : null;
					const timeToBeat = ttbEntry
						? {
								hastily: secondsToMinutes(ttbEntry["hastily"]),
								normally: secondsToMinutes(ttbEntry["normally"]),
								completely: secondsToMinutes(ttbEntry["completely"]),
							}
						: null;
					const gameSlug = stringValue(game?.["slug"]) ?? toSlug(name);
					return {
						name,
						relatedEntityGroups: [
							{
								direction: "incoming" as const,
								synchronization: "additive" as const,
								entities: collectCompanies(game?.["involved_companies"]),
								relationshipSchemaSlug: "company-to-video-game",
							},
							{
								direction: "incoming" as const,
								synchronization: "additive" as const,
								entities: collectGroups(game?.["collections"]),
								relationshipSchemaSlug: "video-game-group-to-video-game",
							},
							{
								direction: "outgoing" as const,
								synchronization: "authoritative" as const,
								entities: collectSuggestions(game?.["similar_games"]),
								relationshipSchemaSlug: "media-suggestion",
							},
						],
						properties: {
							images,
							genres,
							timeToBeat,
							description: stringValue(game?.["summary"]),
							providerRating: numberValue(game?.["rating"]),
							platformReleases: buildPlatformReleases(game?.["release_dates"]),
							sourceUrl: `https://www.igdb.com/games/${gameSlug}`,
							publishYear: extractYear(game?.["first_release_date"]),
						},
					};
				}),
			),
		);
	},
});
