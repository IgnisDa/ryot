import { defineManifest } from "@ryot/sandbox-sdk/core";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../../script-helpers/records";
import {
	type RoleRelatedEntity,
	createRoleAccumulator,
} from "../../../script-helpers/role-accumulator";
import {
	buildIgdbImageUrl,
	buildPagination,
	makeIgdbRequest,
	readTotalItems,
	toSlug,
} from "../../igdb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB",
	slug: "video-game.igdb",
	providerInformation: { source: "igdb" },
	requiredAppConfigKeys: ["videoGames.twitchClientId", "videoGames.twitchClientSecret"],
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
});

const IMAGE_BASE_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";

const getImageUrl = (imageId: string) => buildIgdbImageUrl(IMAGE_BASE_URL, imageId);

const extractYear = (unixTimestamp: unknown) => {
	const value = numberValue(unixTimestamp);
	return value === null ? null : dayjs.unix(value).year();
};

const unixToIsoDate = (unixTimestamp: unknown) => {
	const value = numberValue(unixTimestamp);
	if (value === null) {
		return null;
	}
	const parsed = dayjs.unix(value);
	return parsed.isValid() ? (parsed.toISOString().split("T")[0] ?? null) : null;
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
			scriptSlug: "company.igdb",
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
			scriptSlug: "video-game-group.igdb",
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
		return [{ name, externalId: String(Math.trunc(id)), scriptSlug: "video-game.igdb" }];
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

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const offset = (input.page - 1) * input.pageSize;
	const body = [
		`fields ${SEARCH_FIELDS};`,
		"where version_parent = null;",
		`search "${input.query}";`,
		`limit ${input.pageSize};`,
		`offset ${offset};`,
	].join("\n");
	return makeIgdbRequest(host, "games", body).then(({ data: results, headers }) => {
		if (!Array.isArray(results)) {
			throw new Error("IGDB search returned unexpected response format");
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
					externalId: String(id),
					calloutProperty: { kind: "null" as const, value: null },
					titleProperty: { kind: "text" as const, value: name },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
					imageProperty:
						image === null
							? { kind: "null" as const, value: null }
							: { kind: "image" as const, value: { type: "remote" as const, url: image } },
					primarySubtitleProperty:
						publishYear === null
							? { kind: "null" as const, value: null }
							: { kind: "number" as const, value: publishYear },
				},
			];
		});
		return { items, details: buildPagination(offset, results.length, totalItems, input.page) };
	});
});

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric IGDB game ID (e.g., '1020')");
	}
	const gameBody = [`fields ${DETAIL_FIELDS};`, `where id = ${input.externalId};`].join("\n");
	const ttbBody = [
		"fields normally, hastily, completely;",
		`where game_id = ${input.externalId};`,
	].join("\n");
	return Promise.all([
		makeIgdbRequest(host, "games", gameBody),
		makeIgdbRequest(host, "game_time_to_beats", ttbBody),
	]).then(([gameResult, ttbResult]) => {
		const gameList = gameResult.data;
		if (!Array.isArray(gameList) || gameList.length === 0) {
			throw new Error("IGDB returned no game data for this externalId");
		}
		const game = asRecord(gameList[0]);
		const name = stringValue(game?.["name"]);
		if (!name) {
			throw new Error("IGDB game payload is missing name");
		}

		const images: Array<{ type: "remote"; url: string }> = [];
		const coverImageId = stringValue(asRecord(game?.["cover"])?.["image_id"]);
		if (coverImageId) {
			images.push({ type: "remote", url: getImageUrl(coverImageId) });
		}
		for (const artwork of Array.isArray(game?.["artworks"]) ? game["artworks"] : []) {
			const artworkImageId = stringValue(asRecord(artwork)?.["image_id"]);
			if (artworkImageId) {
				images.push({ type: "remote", url: getImageUrl(artworkImageId) });
			}
		}

		const genres = (Array.isArray(game?.["genres"]) ? game["genres"] : []).flatMap((g) => {
			const genreName = stringValue(asRecord(g)?.["name"]);
			return genreName ? [genreName] : [];
		});

		const ttbList = ttbResult.data;
		const ttbEntry = Array.isArray(ttbList) && ttbList.length > 0 ? asRecord(ttbList[0]) : null;
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
	});
});

export default defineProvider({ manifest, drivers: { search, details } });
