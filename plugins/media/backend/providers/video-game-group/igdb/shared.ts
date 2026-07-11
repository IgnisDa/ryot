import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../../lib/records";
import {
	buildIgdbImageUrl,
	buildPagination,
	makeIgdbRequest,
	readTotalItems,
	toSlug,
} from "../../../lib/vendors/igdb";

export const manifest = defineManifest({
	name: "IGDB",
	kind: "provider",
	requiredSystemConfigKeys: [],
	slug: "video-game-group.igdb",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

const IMAGE_BASE_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";

const getImageUrl = (imageId: string) => buildIgdbImageUrl(IMAGE_BASE_URL, imageId);

const COLLECTION_FIELDS =
	"fields id, name, games.id, games.name, games.cover.*, games.version_parent;";

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		Effect.gen(function* () {
			const offset = (input.page - 1) * input.pageSize;
			const body = [
				COLLECTION_FIELDS,
				`search "${input.query}";`,
				`limit ${input.pageSize};`,
				`offset: ${offset};`,
			].join("\n");
			const { headers, data: results } = yield* makeIgdbRequest(host, "collections", body);
			if (!Array.isArray(results)) {
				return yield* Effect.fail(new Error("IGDB search returned unexpected response format"));
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
						title: name,
						externalId: String(id),
						...(image === null ? {} : { imageUrl: image }),
						...(parts === null ? {} : { metadata: [parts] as const }),
					},
				];
			});
			return { items, details: buildPagination(offset, results.length, totalItems, input.page) };
		}),
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* Effect.fail(new Error("externalId must be a numeric IGDB collection ID"));
			}
			const body = [COLLECTION_FIELDS, `where id = ${input.externalId};`].join("\n");
			const { data: results } = yield* makeIgdbRequest(host, "collections", body);
			if (!Array.isArray(results) || results.length === 0) {
				return yield* Effect.fail(
					new Error("IGDB returned no collection data for this externalId"),
				);
			}
			const collection = asRecord(results[0]);
			const title = stringValue(collection?.["name"]);
			if (!title) {
				return yield* Effect.fail(new Error("IGDB collection payload is missing name"));
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
						providerSlug: "video-game.igdb",
						externalId: String(Math.trunc(id)),
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
						entities: relatedEntities,
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "video-game-group-to-video-game",
					},
				],
			};
		}),
});
