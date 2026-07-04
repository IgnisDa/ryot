import { defineManifest } from "@ryot/sandbox-sdk/core";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../script-helpers/records";
import {
	buildIgdbImageUrl,
	buildPagination,
	makeIgdbRequest,
	readTotalItems,
	toSlug,
} from "../igdb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB",
	slug: "video-game-group.igdb",
	providerInformation: { source: "igdb" },
	requiredAppConfigKeys: ["videoGames.twitchClientId", "videoGames.twitchClientSecret"],
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
});

const IMAGE_BASE_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";

const getImageUrl = (imageId: string) => buildIgdbImageUrl(IMAGE_BASE_URL, imageId);

const COLLECTION_FIELDS =
	"fields id, name, games.id, games.name, games.cover.*, games.version_parent;";

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const offset = (input.page - 1) * input.pageSize;
	const body = [
		COLLECTION_FIELDS,
		`search "${input.query}";`,
		`limit ${input.pageSize};`,
		`offset: ${offset};`,
	].join("\n");
	return makeIgdbRequest(host, "collections", body).then(({ data: results, headers }) => {
		if (!Array.isArray(results)) {
			throw new Error("IGDB search returned unexpected response format");
		}
		const totalItems = readTotalItems(headers, results.length, offset);
		const items = results.flatMap((collection) => {
			const record = asRecord(collection);
			const id = numberValue(record?.["id"]);
			const name = stringValue(record?.["name"]);
			if (id === null || !name) {
				return [];
			}
			const games = Array.isArray(record?.["games"]) ? record["games"] : [];
			const parts = games.length > 0 ? games.length : null;
			const firstCover = games
				.map((game) => stringValue(asRecord(asRecord(game)?.["cover"])?.["image_id"]))
				.find((imageId) => imageId !== null);
			const image = firstCover ? getImageUrl(firstCover) : null;
			return [
				{
					externalId: String(id),
					calloutProperty: { kind: "null" as const, value: null },
					titleProperty: { kind: "text" as const, value: name },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
					primarySubtitleProperty:
						parts === null
							? { kind: "null" as const, value: null }
							: { kind: "number" as const, value: parts },
					imageProperty:
						image === null
							? { kind: "null" as const, value: null }
							: { kind: "image" as const, value: { type: "remote" as const, url: image } },
				},
			];
		});
		return { items, details: buildPagination(offset, results.length, totalItems, input.page) };
	});
});

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric IGDB collection ID");
	}
	const body = [COLLECTION_FIELDS, `where id = ${input.externalId};`].join("\n");
	return makeIgdbRequest(host, "collections", body).then(({ data: results }) => {
		if (!Array.isArray(results) || results.length === 0) {
			throw new Error("IGDB returned no collection data for this externalId");
		}
		const collection = asRecord(results[0]);
		const title = stringValue(collection?.["name"]);
		if (!title) {
			throw new Error("IGDB collection payload is missing name");
		}

		const games = (Array.isArray(collection?.["games"]) ? collection["games"] : []).filter(
			(game) => {
				const record = asRecord(game);
				if (!record) {
					return false;
				}
				const versionParent = record["version_parent"];
				return versionParent === null || versionParent === undefined;
			},
		);
		const parts = games.length;

		const relatedEntities = games.flatMap((game, index) => {
			const record = asRecord(game);
			const id = numberValue(record?.["id"]);
			if (id === null) {
				return [];
			}
			return [
				{
					externalId: String(Math.trunc(id)),
					scriptSlug: "video-game.igdb",
					relationshipProperties: { order: index + 1 },
					name: stringValue(record?.["name"]) ?? "Loading...",
				},
			];
		});

		return {
			name: title,
			properties: {
				parts,
				images: [],
				sourceUrl: `https://www.igdb.com/collection/${toSlug(title)}`,
			},
			relatedEntityGroups: [
				{
					direction: "outgoing" as const,
					entities: relatedEntities,
					synchronization: "authoritative" as const,
					relationshipSchemaSlug: "video-game-group-to-video-game",
				},
			],
		};
	});
});

export default defineProvider({ manifest, drivers: { search, details } });
