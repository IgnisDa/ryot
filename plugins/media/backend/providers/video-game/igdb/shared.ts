import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	defineProvider,
	type ProviderDetailsRelatedEntity,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord, strictStruct } from "@ryot-app/plugin-backend-sdk/wire";

import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { mediaGenreGroups } from "../../../lib/media-genres";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, stringValue } from "../../../lib/records";
import { createRoleAccumulator, type RoleRelatedEntity } from "../../../lib/role-accumulator";
import {
	buildIgdbImageUrl,
	buildPagination,
	type IgdbHost,
	makeIgdbRequest,
	readTotalItems,
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
	return DateTime.getPartUtc(DateTime.makeUnsafe(value * 1000), "year");
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
	if (involvedCompanies === null || involvedCompanies === undefined) {
		return [];
	}
	if (!Array.isArray(involvedCompanies)) {
		throw new MediaSandboxError({ message: "IGDB involved companies list is malformed" });
	}
	const validCompanies: Array<{
		readonly id: number;
		readonly company: Record<string, unknown>;
		readonly involvedCompany: Record<string, unknown>;
	}> = [];
	for (const involvedCompany of involvedCompanies) {
		const record = asRecord(involvedCompany);
		const company = asRecord(record?.["company"]);
		const id = numberValue(company?.["id"]);
		if (!record || !company || id === null || !Number.isSafeInteger(id) || id <= 0) {
			throw new MediaSandboxError({ message: "IGDB involved company identity is malformed" });
		}
		validCompanies.push({ id, company, involvedCompany: record });
	}
	const accumulator = createRoleAccumulator();
	for (const { id, company, involvedCompany } of validCompanies) {
		const name = stringValue(company["name"]) ?? "Loading...";
		let role = "Developer";
		if (involvedCompany["developer"]) {
			role = "Developer";
		} else if (involvedCompany["publisher"]) {
			role = "Publisher";
		} else if (involvedCompany["porting"]) {
			role = "Porting";
		} else if (involvedCompany["supporting"]) {
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
	for (const collection of asArray(collections)) {
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
	asArray(similarGames).flatMap((game) => {
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
const gameTypeName = (game: null | Record<string, unknown>) =>
	stringValue(asRecord(game?.["game_type"])?.["type"]);
const gameId = (value: unknown) => {
	const id = numberValue(typeof value === "object" ? asRecord(value)?.["id"] : value);
	return id === null ? null : String(Math.trunc(id));
};
const parentGameKind = (parentType: null | string, childType: null | string) =>
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
	gameRecord: null | Record<string, unknown>,
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
const collectParents = (game: null | Record<string, unknown>) => {
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
const readChildPage = (host: IgdbHost, externalId: string, offset: number) => {
	const body = [
		"fields id, name, game_type.type, parent_game, version_parent;",
		`where parent_game = ${externalId} | version_parent = ${externalId};`,
		"sort id asc;",
		`limit ${CHILD_PAGE_SIZE};`,
		`offset ${offset};`,
	].join("\n");
	return makeIgdbRequest(host, "games", body);
};
const childPageHasMore = (
	headers: Readonly<Record<string, string>>,
	rows: readonly unknown[],
	offset: number,
) => {
	const rawCount = headers["x-count"];
	const count = typeof rawCount === "string" ? Number(rawCount) : Number.NaN;
	return Number.isSafeInteger(count)
		? offset + rows.length < count
		: rows.length === CHILD_PAGE_SIZE;
};
const childContinuation = (offset: number, parentType: null | string) => ({ offset, parentType });
const childPageCoverage = (
	headers: Readonly<Record<string, string>>,
	rows: readonly unknown[],
	offset: number,
	parentType: null | string,
) =>
	childPageHasMore(headers, rows, offset)
		? { status: "more" as const, continuation: childContinuation(offset + rows.length, parentType) }
		: { status: "complete" as const };
const readChildContinuation = (value: unknown) => {
	const record = asRecord(value);
	const offset = numberValue(record?.["offset"]);
	const parentType = record?.["parentType"];
	return offset !== null &&
		Number.isSafeInteger(offset) &&
		offset >= 0 &&
		(parentType === null || typeof parentType === "string")
		? Effect.succeed({ offset, parentType })
		: Effect.fail(new MediaSandboxError({ message: "Invalid IGDB game child continuation" }));
};
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
			readChildPage(host, input.externalId, 0),
		]).pipe(
			Effect.flatMap(([gameResult, ttbResult, childPage]) =>
				Effect.gen(function* () {
					const gameList = gameResult.data;
					if (gameList.length === 0) {
						return yield* new MediaSandboxError({
							message: "IGDB returned no game data for this externalId",
						});
					}
					const game = asRecord(gameList[0]);
					const parentType = gameTypeName(game);
					const companies = yield* Effect.try({
						try: () => collectCompanies(game?.["involved_companies"]),
						catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
					});
					const name = stringValue(game?.["name"]);
					if (!name) {
						return yield* new MediaSandboxError({ message: "IGDB game payload is missing name" });
					}
					const images: Array<{ url: string; type: "remote"; purpose: string }> = [];
					const coverImageId = stringValue(asRecord(game?.["cover"])?.["image_id"]);
					if (coverImageId) {
						images.push({
							type: "remote",
							purpose: "cover" as const,
							url: getImageUrl(coverImageId),
						});
					}
					for (const artwork of asArray(game?.["artworks"])) {
						const artworkImageId = stringValue(asRecord(artwork)?.["image_id"]);
						if (artworkImageId) {
							images.push({
								type: "remote",
								purpose: "artwork" as const,
								url: getImageUrl(artworkImageId),
							});
						}
					}
					const rawGenres = game?.["genres"];
					if (rawGenres !== undefined && rawGenres !== null && !Array.isArray(rawGenres)) {
						return yield* new MediaSandboxError({ message: "IGDB genres must be an array" });
					}
					const genres =
						rawGenres === undefined || rawGenres === null
							? null
							: rawGenres.flatMap((g) => {
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
							timeToBeat,
							gameType: gameTypeName(game),
							providerRating: numberValue(game?.["rating"]),
							sourceUrl: `https://www.igdb.com/games/${gameSlug}`,
							publishYear: extractYear(game?.["first_release_date"]),
							description: normalizePlainDescription(game?.["summary"]),
							platformReleases: buildPlatformReleases(game?.["release_dates"]),
						},
						relatedEntityGroups: [
							{
								entities: companies,
								direction: "incoming" as const,
								coverage: { status: "complete" as const },
								synchronization: "authoritative" as const,
								relationshipSchemaSlug: "company-to-video-game",
							},
							{
								direction: "incoming" as const,
								coverage: { status: "complete" as const },
								synchronization: "authoritative" as const,
								entities: collectGroups(game?.["collections"]),
								relationshipSchemaSlug: "video-game-group-to-video-game",
							},
							{
								direction: "outgoing" as const,
								coverage: { status: "complete" as const },
								synchronization: "authoritative" as const,
								relationshipSchemaSlug: "media-suggestion",
								entities: collectSuggestions(game?.["similar_games"]),
							},
							{
								direction: "outgoing" as const,
								synchronization: "authoritative" as const,
								entities: collectChildren(game, childPage.data),
								relationshipSchemaSlug: "video-game-to-video-game",
								coverage: childPageCoverage(childPage.headers, childPage.data, 0, parentType),
							},
							{
								direction: "incoming" as const,
								entities: collectParents(game),
								coverage: { status: "complete" as const },
								synchronization: "authoritative" as const,
								relationshipSchemaSlug: "video-game-to-video-game",
							},
							...mediaGenreGroups("video-game", genres),
						],
					};
				}),
			),
		);
	},
});

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* new MediaSandboxError({
					message: "externalId must be a numeric IGDB game ID",
				});
			}
			if (
				input.relationshipSchemaSlug !== "video-game-to-video-game" ||
				input.direction !== "outgoing"
			) {
				return yield* new MediaSandboxError({
					message: `Unsupported IGDB game relationship: ${input.relationshipSchemaSlug}`,
				});
			}
			const { offset, parentType } = yield* readChildContinuation(input.continuation);
			const { data, headers } = yield* readChildPage(host, input.externalId, offset);
			const parent = {
				id: Number(input.externalId),
				game_type: parentType === null ? null : { type: parentType },
			};
			return {
				entities: collectChildren(parent, data),
				coverage: childPageCoverage(headers, data, offset, parentType),
			};
		}),
});
