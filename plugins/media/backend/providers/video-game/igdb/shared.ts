import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider, type ProviderDetailsRelatedEntity } from "@ryot-app/sandbox-sdk/provider";
import { strictStruct } from "@ryot-app/sandbox-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { asRecord, numberValue, stringValue } from "../../../lib/records";
import { type RoleRelatedEntity, createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	buildIgdbImageUrl,
	buildPagination,
	makeIgdbRequest,
	readTotalItems,
	type IgdbHost,
	toSlug,
} from "../../../lib/vendors/igdb";

export const manifest = defineManifest({ name: "IGDB", kind: "provider", slug: "video-game.igdb" });
const IMAGE_BASE_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";
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
		return [{ releaseDate, releaseRegion, name: platformName }];
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
			providerSlug: "company.igdb",
			externalId: String(Math.trunc(id)),
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
		return [{ name, providerSlug: "video-game.igdb", externalId: String(Math.trunc(id)) }];
	});
const MAIN_GAME_TYPE = "Main Game";
const BUNDLE_TYPE = "Bundle";
const EDITION_KIND = "Edition";
const RELATED_KIND = "Related";
const CHILD_PAGE_SIZE = 500;
const CHILD_MAX_PAGES = 4;
const gameTypeName = (game: Record<string, unknown> | null) =>
	stringValue(asRecord(game?.["game_type"])?.["type"]);
const gameId = (value: unknown) => {
	const id = numberValue(typeof value === "object" ? asRecord(value)?.["id"] : value);
	return id === null ? null : String(Math.trunc(id));
};
const parentGameKind = (parentType: string | null, childType: string | null) =>
	parentType === BUNDLE_TYPE || childType === BUNDLE_TYPE ? null : (childType ?? RELATED_KIND);
const videoGameRelation = (
	externalId: string,
	name: unknown,
	kind: string,
): ProviderDetailsRelatedEntity => ({
	externalId,
	providerSlug: "video-game.igdb",
	relationshipProperties: { kind },
	name: stringValue(name) ?? "Loading...",
});
const collectChildren = (
	gameRecord: Record<string, unknown> | null,
	children: readonly unknown[],
) => {
	const parentId = gameId(gameRecord);
	const parentType = gameTypeName(gameRecord);
	const entities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const child of children) {
		const record = asRecord(child);
		const externalId = gameId(record);
		if (externalId === null || entities.has(externalId)) {
			continue;
		}
		const kind =
			gameId(record?.["version_parent"]) === parentId
				? EDITION_KIND
				: parentGameKind(parentType, gameTypeName(record));
		if (kind !== null) {
			entities.set(externalId, videoGameRelation(externalId, record?.["name"], kind));
		}
	}
	return [...entities.values()];
};
const collectParents = (game: Record<string, unknown> | null) => {
	const entities = new Map<string, ProviderDetailsRelatedEntity>();
	const versionParent = asRecord(game?.["version_parent"]);
	const versionParentId = gameId(versionParent);
	if (versionParentId !== null) {
		entities.set(
			versionParentId,
			videoGameRelation(versionParentId, versionParent?.["name"], EDITION_KIND),
		);
	}
	const parent = asRecord(game?.["parent_game"]);
	const parentId = gameId(parent);
	if (parentId !== null && !entities.has(parentId)) {
		const kind = parentGameKind(gameTypeName(parent), gameTypeName(game));
		if (kind !== null) {
			entities.set(parentId, videoGameRelation(parentId, parent?.["name"], kind));
		}
	}
	return [...entities.values()];
};
const loadChildren = (host: IgdbHost, externalId: string) =>
	Effect.gen(function* () {
		const rows: unknown[] = [];
		for (let page = 0; page < CHILD_MAX_PAGES; page += 1) {
			const body = [
				"fields id, name, game_type.type, parent_game, version_parent;",
				`where parent_game = ${externalId} | version_parent = ${externalId};`,
				"sort id asc;",
				`limit ${CHILD_PAGE_SIZE};`,
				`offset ${page * CHILD_PAGE_SIZE};`,
			].join("\n");
			const { data } = yield* makeIgdbRequest(host, "games", body);
			if (!Array.isArray(data)) {
				return yield* new MediaSandboxError({
					message: "IGDB game children returned unexpected response format",
				});
			}
			rows.push(...data);
			if (data.length < CHILD_PAGE_SIZE) {
				return { rows, complete: true };
			}
		}
		return { rows, complete: false };
	});
const SEARCH_FIELDS = "id, name, cover.image_id, first_release_date, game_type.type";
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
	"game_type.type",
	"parent_game.id",
	"parent_game.name",
	"version_parent.id",
	"version_parent.name",
	"parent_game.game_type.type",
].join(", ");
const IGDB_OPTIONS_PAGE_SIZE = 500;
const searchOptionSources = {
	themes: { path: "themes", fields: "id,name", labelField: "name" },
	genres: { path: "genres", fields: "id,name", labelField: "name" },
	platforms: { fields: "id,name", path: "platforms", labelField: "name" },
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
				return yield* new MediaSandboxError({
					message: `IGDB ${source.path} returned unexpected response format`,
				});
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
			const options = yield* Schema.decodeEffect(igdbSearchOptionsSchema)(input.options ?? {});
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
				Effect.flatMap(({ headers, data: results }) => {
					if (!Array.isArray(results)) {
						return Effect.fail(
							new MediaSandboxError({ message: "IGDB search returned unexpected response format" }),
						);
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
						const gameType = gameTypeName(record);
						const [firstMetadata, ...restMetadata] = [
							...(publishYear === null ? [] : [publishYear]),
							...(gameType === null || gameType === MAIN_GAME_TYPE ? [] : [gameType]),
						];
						const imageId = stringValue(asRecord(record?.["cover"])?.["image_id"]);
						const image = imageId ? getImageUrl(imageId) : null;
						return [
							{
								title: name,
								externalId: String(id),
								...(image === null ? {} : { imageUrl: image }),
								...(firstMetadata === undefined
									? {}
									: { metadata: [firstMetadata, ...restMetadata] as const }),
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
			return Effect.fail(
				new MediaSandboxError({
					message: "externalId must be a numeric IGDB game ID (e.g., '1020')",
				}),
			);
		}
		const gameBody = [`fields ${DETAIL_FIELDS};`, `where id = ${input.externalId};`].join("\n");
		const ttbBody = [
			"fields normally, hastily, completely;",
			`where game_id = ${input.externalId};`,
		].join("\n");
		return Effect.all([
			makeIgdbRequest(host, "games", gameBody),
			makeIgdbRequest(host, "game_time_to_beats", ttbBody),
			loadChildren(host, input.externalId),
		]).pipe(
			Effect.flatMap(([gameResult, ttbResult, children]) =>
				Effect.gen(function* () {
					const gameList = gameResult.data;
					if (!Array.isArray(gameList) || gameList.length === 0) {
						return yield* new MediaSandboxError({
							message: "IGDB returned no game data for this externalId",
						});
					}
					const game = asRecord(gameList[0]);
					const name = stringValue(game?.["name"]);
					if (!name) {
						return yield* new MediaSandboxError({ message: "IGDB game payload is missing name" });
					}
					const images: Array<{ type: "remote"; url: string; purpose: string }> = [];
					const coverImageId = stringValue(asRecord(game?.["cover"])?.["image_id"]);
					if (coverImageId) {
						images.push({
							type: "remote",
							purpose: "cover" as const,
							url: getImageUrl(coverImageId),
						});
					}
					for (const artwork of Array.isArray(game?.["artworks"]) ? game["artworks"] : []) {
						const artworkImageId = stringValue(asRecord(artwork)?.["image_id"]);
						if (artworkImageId) {
							images.push({
								type: "remote",
								purpose: "artwork" as const,
								url: getImageUrl(artworkImageId),
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
						properties: {
							images,
							genres,
							timeToBeat,
							gameType: gameTypeName(game),
							description: stringValue(game?.["summary"]),
							providerRating: numberValue(game?.["rating"]),
							sourceUrl: `https://www.igdb.com/games/${gameSlug}`,
							publishYear: extractYear(game?.["first_release_date"]),
							platformReleases: buildPlatformReleases(game?.["release_dates"]),
						},
						relatedEntityGroups: [
							{
								direction: "incoming" as const,
								synchronization: "additive" as const,
								relationshipSchemaSlug: "company-to-video-game",
								entities: collectCompanies(game?.["involved_companies"]),
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
								relationshipSchemaSlug: "media-suggestion",
								entities: collectSuggestions(game?.["similar_games"]),
							},
							{
								direction: "outgoing" as const,
								entities: collectChildren(game, children.rows),
								relationshipSchemaSlug: "video-game-to-video-game",
								synchronization: children.complete
									? ("authoritative" as const)
									: ("additive" as const),
							},
							{
								direction: "incoming" as const,
								entities: collectParents(game),
								synchronization: "authoritative" as const,
								relationshipSchemaSlug: "video-game-to-video-game",
							},
						],
					};
				}),
			),
		);
	},
});
